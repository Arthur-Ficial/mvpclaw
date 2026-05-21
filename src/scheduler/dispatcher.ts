/**
 * Scheduler dispatcher — fires due tasks through the agent pipeline.
 *
 * One sweep does, atomically per task:
 *   1. `findDueTasks(now)` — only `state='scheduled' AND next_run_at <= now`.
 *   2. `claimTask(id, leaseOwner, ttl)` — wins the row or skips.
 *   3. Build a synthetic `InboundMessage` from `(task, chat)` and drive it
 *      through `routeInbound` → `runAgentTurn` → mark outbox `is_proactive=1`
 *      → `drainOutbox`. Defaults can be overridden via `runPipeline` for tests.
 *   4. On success: `markTaskCompleted` (one_shot) or `markTaskRescheduled`
 *      to the next cron firing (recurring).
 *   5. On throw: `markTaskFailed(error)`. When `attempts >= max_attempts`,
 *      additionally mark `dead` so the dispatcher stops retrying.
 *
 * The dispatcher does NOT compute lease recovery — that's `recoverLeases()`
 * called once at daemon boot from `start.cmd.ts`. The dispatcher is the
 * happy-path loop; recovery is a one-off bootstrapping step.
 */
import { ChatsRepo, TasksRepo, type ChatRow, type Db, type TaskRow } from '../db/index.js';
import type { InboundMessage } from '../channels/index.js';
import type { AppContext } from '../app/index.js';
import { routeInbound, runAgentTurn, drainOutbox } from '../app/index.js';
import { parseCron } from './recurrence.js';

/** Counters returned by one `dispatchDueTasks` sweep. */
export interface DispatchResult {
  /** How many tasks we won a lease on this sweep. */
  claimed: number;
  /** How many of those finished successfully (one_shot completed OR recurring rescheduled). */
  completed: number;
  /** How many threw and were marked failed (or dead, if attempts maxed). */
  failed: number;
}

/** Caller-injectable seam used by tests; production passes the real pipeline. */
export type RunPipeline = (
  ctx: AppContext,
  inbound: InboundMessage,
  task: TaskRow,
) => Promise<void>;

/** Options for `dispatchDueTasks`. */
export interface DispatchOptions {
  /** Reference time (ms UTC). Defaults to `Date.now()` — injected by tests. */
  now?: number;
  /** Max tasks to claim per sweep. Defaults to 8. */
  limit?: number;
  /** Lease TTL — how long a claim is valid before `recoverLeases` may steal it. Default 5 min. */
  leaseTtlMs?: number;
  /** Unique-ish owner string for the lease. Defaults to `dispatcher:<pid>`. */
  leaseOwner?: string;
  /** Pipeline injection point — production uses `defaultRunPipeline` below. */
  runPipeline?: RunPipeline;
}

const DEFAULT_LIMIT = 8;
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * Build the synthetic `InboundMessage` that the orchestrator will route as if
 * a real channel had produced it.
 *
 * @param task - The task being dispatched.
 * @param chat - The chat row the task targets (resolves `provider`/`provider_chat_id`).
 * @param fireAt - The intended firing instant (ms UTC); used in `providerUpdateId` for dedup.
 * @returns A normalized `InboundMessage`.
 */
export function buildSyntheticInbound(
  task: TaskRow,
  chat: ChatRow,
  fireAt: number,
): InboundMessage {
  return {
    id: `scheduler:${task.id}:${fireAt}`,
    channel: chat.provider,
    providerUpdateId: `scheduler-${task.id}-${fireAt}`,
    providerChatId: chat.provider_chat_id,
    providerUserId: 'scheduler',
    text: task.prompt,
    receivedAt: new Date(fireAt).toISOString(),
  };
}

/**
 * Production `runPipeline`: route → run → mark outbox proactive → drain.
 * Mirrors `sendInjectedMessage` but skips the SendOutcome plumbing the CLI needs.
 */
async function defaultRunPipeline(
  ctx: AppContext,
  inbound: InboundMessage,
  _task: TaskRow,
): Promise<void> {
  const resolved = routeInbound(ctx.db, inbound, ctx.config.idle);
  if (resolved.isDuplicate || resolved.isHandledCommand) {
    await drainOutbox(ctx, { chat_id: resolved.chat.id });
    return;
  }
  const result = await runAgentTurn(ctx, resolved);
  // Tag every outbox row this run produced as proactive so quiet-hours +
  // daily-cap policy in `evaluateProactive()` applies before send.
  ctx.db
    .prepare("UPDATE outbox SET is_proactive = 1 WHERE run_id = ? AND status = 'pending'")
    .run(result.runId);
  await drainOutbox(ctx, { chat_id: resolved.chat.id });
  if (result.status === 'failed') {
    throw new Error(result.error ?? 'agent turn failed');
  }
}

/**
 * Run one dispatcher sweep — claim every currently-due task and process it.
 *
 * @param ctx - Wired application context (or test stub).
 * @param opts - Optional overrides.
 * @returns A `DispatchResult` describing what happened this sweep.
 */
export async function dispatchDueTasks(
  ctx: AppContext,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseOwner = opts.leaseOwner ?? `dispatcher:${process.pid}`;
  const runPipeline = opts.runPipeline ?? defaultRunPipeline;

  const due = TasksRepo.findDueTasks(ctx.db, now, limit);
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  for (const task of due) {
    if (!TasksRepo.claimTask(ctx.db, task.id, leaseOwner, leaseTtlMs)) {
      continue;
    }
    claimed++;
    const fresh = TasksRepo.findTaskById(ctx.db, task.id) as TaskRow;
    const chat = ChatsRepo.findChatById(ctx.db, fresh.chat_id);
    if (!chat) {
      TasksRepo.markTaskFailed(ctx.db, fresh.id, `chat ${fresh.chat_id} not found`);
      failed++;
      continue;
    }
    const inbound = buildSyntheticInbound(fresh, chat, now);
    try {
      await runPipeline(ctx, inbound, fresh);
      if (fresh.kind === 'recurring' && fresh.cron_expr) {
        const next = parseCron(fresh.cron_expr, fresh.timezone, now);
        if (!next.ok) {
          TasksRepo.markTaskFailed(ctx.db, fresh.id, `cron parse: ${next.error}`);
          failed++;
          continue;
        }
        TasksRepo.markTaskRescheduled(ctx.db, fresh.id, next.nextRunAt);
      } else {
        TasksRepo.markTaskCompleted(ctx.db, fresh.id);
      }
      completed++;
      ctx.log.info(
        { taskId: fresh.id, chatId: fresh.chat_id, prompt_len: fresh.prompt.length },
        'dispatcher: task fired',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      TasksRepo.markTaskFailed(ctx.db, fresh.id, msg);
      // attempts was incremented by claimTask; check if we hit the cap.
      const finalRow = TasksRepo.findTaskById(ctx.db, fresh.id) as TaskRow;
      if (finalRow.attempts >= finalRow.max_attempts) {
        markDead(ctx.db, fresh.id);
      }
      failed++;
      ctx.log.warn({ taskId: fresh.id, error: msg }, 'dispatcher: task failed');
    }
  }

  return { claimed, completed, failed };
}

/** Force a task into the terminal `dead` state. Used when attempts hit the cap. */
function markDead(db: Db, id: string): void {
  db.prepare("UPDATE tasks SET state = 'dead', updated_at = ? WHERE id = ?").run(Date.now(), id);
}
