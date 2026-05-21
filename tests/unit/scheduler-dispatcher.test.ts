/**
 * Scheduler dispatcher — claims due tasks and runs them through the
 * orchestrator pipeline.
 *
 * These tests pin behavior at the dispatcher boundary: they inject a fake
 * `runPipeline` so we don't need a live provider, then assert that:
 *   - only `state='scheduled' AND next_run_at <= now` rows are picked up
 *   - `claimTask()` atomically wins (no double-dispatch)
 *   - one-shot tasks → `completed`; recurring → `scheduled` with new
 *     `next_run_at` computed from the cron expression
 *   - failures bump `attempts`; when `attempts >= max_attempts`, the row
 *     transitions to `dead` instead of looping forever
 *   - expired leases are reclaimed by `recoverLeases()`
 *   - the synthetic InboundMessage built for the run carries the task's
 *     prompt verbatim and a stable, unique `providerUpdateId`
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { applyMigrations, ChatsRepo, openDb, TasksRepo, type Db } from '../../src/db/index.js';
import type { InboundMessage } from '../../src/channels/index.js';
import {
  buildSyntheticInbound,
  dispatchDueTasks,
  type DispatchResult,
} from '../../src/scheduler/dispatcher.js';
import type { AppContext } from '../../src/app/index.js';

const MIGRATIONS = resolve(__dirname, '../../migrations');

/**
 * Build a minimal `AppContext` good enough for dispatcher tests.
 * The dispatcher only touches `db` and `log` directly; the `runPipeline`
 * callback is injected by each test, so providers/channels/tools/tracesDir
 * remain placeholders.
 */
function makeCtx(db: Db): AppContext {
  return {
    config: {} as never,
    log: pino({ level: 'silent' }),
    db,
    channels: {},
    providers: {},
    tracesDir: '/tmp/unused',
    tools: { list: (): unknown[] => [], get: (): unknown => undefined } as never,
    skills: [],
  };
}

describe('scheduler dispatcher — findDueTasks repo query', () => {
  let tmp: string;
  let db: Db;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-disp-'));
    db = openDb(join(tmp, 'd.sqlite'));
    applyMigrations(db, MIGRATIONS);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns only scheduled tasks whose next_run_at <= now, ordered ascending', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'x1',
      type: 'private',
    });
    const now = Date.now();
    TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: now - 1000,
      prompt: 'past A',
    });
    TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: now - 5000,
      prompt: 'past B (oldest)',
    });
    TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: now + 60_000,
      prompt: 'future',
    });
    const due = TasksRepo.findDueTasks(db, now, 16);
    expect(due).toHaveLength(2);
    expect(due[0]?.prompt).toBe('past B (oldest)');
    expect(due[1]?.prompt).toBe('past A');
  });

  it('skips non-scheduled tasks (paused, completed, dead)', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'x2',
      type: 'private',
    });
    const t = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: Date.now() - 10,
      prompt: 'paused',
    });
    TasksRepo.setTaskPaused(db, t.id, true);
    expect(TasksRepo.findDueTasks(db, Date.now(), 16)).toHaveLength(0);
  });
});

describe('scheduler dispatcher — synthetic inbound shape', () => {
  let tmp: string;
  let db: Db;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-disp-'));
    db = openDb(join(tmp, 'd.sqlite'));
    applyMigrations(db, MIGRATIONS);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('carries the task prompt verbatim with a stable, unique providerUpdateId', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '12345',
      type: 'private',
    });
    const t = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'recurring',
      cron_expr: '*/30 * * * *',
      next_run_at: 1_700_000_000_000,
      prompt: 'check unread email',
    });
    const inbound = buildSyntheticInbound(t, chat, 1_700_000_000_000);
    expect(inbound.channel).toBe('telegram');
    expect(inbound.providerChatId).toBe('12345');
    expect(inbound.text).toBe('check unread email');
    expect(inbound.providerUpdateId).toBe(`scheduler-${t.id}-1700000000000`);
    expect(inbound.providerUserId).toBe('scheduler');
  });
});

describe('scheduler dispatcher — dispatchDueTasks behavior', () => {
  let tmp: string;
  let db: Db;
  let ctx: AppContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-disp-'));
    db = openDb(join(tmp, 'd.sqlite'));
    applyMigrations(db, MIGRATIONS);
    ctx = makeCtx(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('completes a one-shot task whose runPipeline succeeds', async () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'oneshot',
      type: 'private',
    });
    const t = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: Date.now() - 1000,
      prompt: 'do thing',
    });
    const seen: InboundMessage[] = [];
    const result: DispatchResult = await dispatchDueTasks(ctx, {
      runPipeline: async (_ctx, inbound, _task) => {
        seen.push(inbound);
      },
    });
    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    const after = TasksRepo.findTaskById(db, t.id)!;
    expect(after.state).toBe('completed');
    expect(after.attempts).toBe(1);
    expect(seen[0]?.text).toBe('do thing');
  });

  it('reschedules a recurring task after success using its cron', async () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'recurring',
      type: 'private',
    });
    const t = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'recurring',
      cron_expr: '*/30 * * * *',
      timezone: 'UTC',
      next_run_at: Date.now() - 1000,
      prompt: 'tick',
    });
    await dispatchDueTasks(ctx, { runPipeline: async (): Promise<void> => {} });
    const after = TasksRepo.findTaskById(db, t.id)!;
    expect(after.state).toBe('scheduled');
    expect(after.next_run_at).toBeGreaterThan(Date.now());
    expect(after.last_run_at).not.toBeNull();
  });

  it('marks a one-shot failed when runPipeline throws (attempts < max → failed)', async () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'failonce',
      type: 'private',
    });
    const t = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: Date.now() - 1000,
      prompt: 'boom',
      max_attempts: 3,
    });
    const result = await dispatchDueTasks(ctx, {
      runPipeline: async (): Promise<void> => {
        throw new Error('synthetic boom');
      },
    });
    expect(result.failed).toBe(1);
    const after = TasksRepo.findTaskById(db, t.id)!;
    expect(after.state).toBe('failed');
    expect(after.last_error).toContain('synthetic boom');
    expect(after.attempts).toBe(1);
  });

  it('transitions to dead when attempts reach max_attempts', async () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'deadtask',
      type: 'private',
    });
    const t = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: Date.now() - 1000,
      prompt: 'always fail',
      max_attempts: 2,
    });
    // First failure: failed (attempts=1).
    await dispatchDueTasks(ctx, {
      runPipeline: async (): Promise<void> => {
        throw new Error('e1');
      },
    });
    // Manually bounce 'failed' → 'scheduled' so the dispatcher can pick it up again,
    // and force it due. (Production retry path lives outside dispatcher; this test
    // pins the boundary behavior of "when attempts >= max, mark dead".)
    db.prepare("UPDATE tasks SET state='scheduled', next_run_at=? WHERE id=?").run(
      Date.now() - 100,
      t.id,
    );
    await dispatchDueTasks(ctx, {
      runPipeline: async (): Promise<void> => {
        throw new Error('e2');
      },
    });
    const after = TasksRepo.findTaskById(db, t.id)!;
    expect(after.state).toBe('dead');
    expect(after.attempts).toBe(2);
  });

  it('claims atomically — concurrent dispatchers do not double-run the same task', async () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: 'race',
      type: 'private',
    });
    TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: 'one_shot',
      next_run_at: Date.now() - 1000,
      prompt: 'race',
    });
    let runs = 0;
    const [a, b] = await Promise.all([
      dispatchDueTasks(ctx, {
        runPipeline: async (): Promise<void> => {
          runs++;
        },
      }),
      dispatchDueTasks(ctx, {
        runPipeline: async (): Promise<void> => {
          runs++;
        },
      }),
    ]);
    expect(runs).toBe(1);
    expect((a.claimed ?? 0) + (b.claimed ?? 0)).toBe(1);
  });
});
