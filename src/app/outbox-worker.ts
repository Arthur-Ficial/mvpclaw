/**
 * Outbox worker — drains pending rows by handing them to the right channel.
 *
 * `drainOutbox(ctx)` reads every `outbox` row in `pending` status, atomically
 * claims each via `claimOutboxRow()` (transitions to `sending`), and calls
 * the appropriate `ChannelAdapter.send()`. On success → `markOutboxSent`.
 * On failure → `markOutboxFailed` (with the error text). Idempotent: a
 * row already `sent` or `cancelled` is left alone.
 *
 * The full scheduler (P11) will own a 1-second tick that calls this; for
 * P4 it's invoked on demand by the orchestrator (right after enqueueing a
 * reply) and by `mvpclaw outbox flush` (C5).
 */
import {
  listOutbox,
  claimOutboxRow,
  markOutboxSent,
  markOutboxFailed,
} from '../db/repos/outbox.repo.js';
import type { AppContext } from './app-context.js';

/** Summary of one drain call. */
export interface DrainResult {
  /** How many rows we tried to send. */
  attempted: number;
  /** How many succeeded (`sent`). */
  sent: number;
  /** How many failed (`failed`). */
  failed: number;
}

/**
 * Drain pending outbox rows in chronological order.
 *
 * @param ctx - The application context.
 * @param filter - Optional `chat_id` filter (used by `mvpclaw outbox flush --chat-id`).
 * @returns A `DrainResult` summarising attempts.
 */
export async function drainOutbox(
  ctx: AppContext,
  filter: { chat_id?: string } = {},
): Promise<DrainResult> {
  const pending = listOutbox(ctx.db, {
    status: 'pending',
    chat_id: filter.chat_id,
    limit: 100,
  });
  // listOutbox is DESC by created_at; reverse so we send oldest first.
  pending.reverse();

  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    if (!claimOutboxRow(ctx.db, row.id)) {
      // Another caller grabbed it between list and claim — skip.
      continue;
    }
    const channel = ctx.channels[row.provider];
    if (!channel) {
      markOutboxFailed(
        ctx.db,
        row.id,
        `no channel adapter registered for provider "${row.provider}"`,
      );
      failed++;
      continue;
    }
    try {
      const result = await channel.send({
        id: row.id,
        channel: row.provider,
        providerChatId: row.provider_chat_id,
        providerThreadId: row.provider_thread_id ?? undefined,
        kind: row.kind,
        text: row.text,
      });
      markOutboxSent(ctx.db, row.id, result.providerMessageId);
      sent++;
    } catch (err) {
      markOutboxFailed(ctx.db, row.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return { attempted: pending.length, sent, failed };
}
