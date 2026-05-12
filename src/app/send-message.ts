/**
 * `sendInjectedMessage` — the use case behind the `mvpclaw send` CLI command.
 *
 * Treats a synthetic `InboundMessage` exactly like a real channel update:
 * routes it (resolving chat + session + dedup), runs the agent turn (if
 * the message isn't a duplicate and isn't a built-in command), drains
 * the outbox via the named channel.
 *
 * Returns a structured `SendOutcome` describing what happened. Callers
 * (the CLI) render this as JSON or a human-readable summary.
 */
import type { InboundMessage } from '../channels/index.js';
import type { AppContext } from './app-context.js';
import { routeInbound } from './inbound-router.js';
import { runAgentTurn } from './agent-orchestrator.js';
import { drainOutbox } from './outbox-worker.js';

/** Outcome of a single `sendInjectedMessage()` call. */
export interface SendOutcome {
  /** ULID of the agent run (null when the message was a duplicate or built-in command). */
  runId: string | null;
  /** Internal chat ULID. */
  chatId: string;
  /** The channel name (e.g. 'cli-inject', 'telegram'). */
  channel: string;
  /** External provider chat id (echoed from the input). */
  providerChatId: string;
  /** External provider update id (echoed from the input). */
  providerUpdateId: string;
  /** Reply text the bot produced. Empty string for duplicate-skipped runs. */
  replyText: string;
  /** Path to the per-run JSONL trace file, or null when no run happened. */
  tracePath: string | null;
  /** Outcome status. */
  status: 'succeeded' | 'failed' | 'duplicate' | 'command';
  /** Wall-clock milliseconds spent inside `sendInjectedMessage`. */
  durationMs: number;
  /** Number of outbox rows successfully sent (1 in the normal case). */
  outboxSent: number;
  /** Number of outbox rows that failed to send. */
  outboxFailed: number;
  /** Error message when status === 'failed'. */
  error?: string;
}

/**
 * Inject a synthetic `InboundMessage` into the orchestrator and drain the
 * outbox via the named channel. The function is the spine of `mvpclaw send`.
 *
 * @param ctx - The wired application context.
 * @param msg - The synthetic `InboundMessage` to process.
 * @returns A `SendOutcome` describing what happened.
 */
export async function sendInjectedMessage(
  ctx: AppContext,
  msg: InboundMessage,
): Promise<SendOutcome> {
  const start = Date.now();
  const resolved = routeInbound(ctx.db, msg);

  // Duplicate: nothing more to do (the router still inserted/identified the row).
  if (resolved.isDuplicate) {
    return {
      runId: null,
      chatId: resolved.chat.id,
      channel: msg.channel,
      providerChatId: msg.providerChatId,
      providerUpdateId: msg.providerUpdateId,
      replyText: '',
      tracePath: null,
      status: 'duplicate',
      durationMs: Date.now() - start,
      outboxSent: 0,
      outboxFailed: 0,
    };
  }

  // Built-in slash command: the router enqueued the reply. Drain.
  if (resolved.isHandledCommand) {
    const drain = await drainOutbox(ctx, { chat_id: resolved.chat.id });
    return {
      runId: null,
      chatId: resolved.chat.id,
      channel: msg.channel,
      providerChatId: msg.providerChatId,
      providerUpdateId: msg.providerUpdateId,
      replyText: '', // CLI can fetch the actual text via `outbox list`
      tracePath: null,
      status: 'command',
      durationMs: Date.now() - start,
      outboxSent: drain.sent,
      outboxFailed: drain.failed,
    };
  }

  // Real agent turn.
  const result = await runAgentTurn(ctx, resolved);
  if (result.status === 'failed') {
    return {
      runId: result.runId,
      chatId: resolved.chat.id,
      channel: msg.channel,
      providerChatId: msg.providerChatId,
      providerUpdateId: msg.providerUpdateId,
      replyText: '',
      tracePath: result.tracePath,
      status: 'failed',
      durationMs: Date.now() - start,
      outboxSent: 0,
      outboxFailed: 0,
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
  }

  // Drain the outbox via the channel.
  const drain = await drainOutbox(ctx, { chat_id: resolved.chat.id });

  return {
    runId: result.runId,
    chatId: resolved.chat.id,
    channel: msg.channel,
    providerChatId: msg.providerChatId,
    providerUpdateId: msg.providerUpdateId,
    replyText: result.replyText,
    tracePath: result.tracePath,
    status: 'succeeded',
    durationMs: Date.now() - start,
    outboxSent: drain.sent,
    outboxFailed: drain.failed,
  };
}
