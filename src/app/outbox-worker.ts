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
  markOutboxCancelled,
} from '../db/repos/outbox.repo.js';
import type { AppContext } from './app-context.js';
import { evaluateProactive, recordProactiveSend, setChatBlocked } from './proactive-policy.js';

/** Summary of one drain call. */
export interface DrainResult {
  /** How many rows we tried to send. */
  attempted: number;
  /** How many succeeded (`sent`). */
  sent: number;
  /** How many failed (`failed`). */
  failed: number;
  /** How many proactive rows were deferred (kept `pending` for a later tick). */
  deferred: number;
  /** How many rows were cancelled by a hard gate (e.g., chat_blocked). */
  cancelled: number;
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
  let deferred = 0;
  let cancelled = 0;
  const tz = ctx.config.app.defaultTimezone;
  for (const row of pending) {
    // Proactive gating — driven by the explicit `is_proactive` column.
    // Historical note: this used to be `row.run_id === null` but that
    // misclassified /help replies (which also have run_id=null but are
    // reactive). See migration 0006_outbox_is_proactive.sql.
    const isProactive = row.is_proactive === 1;
    if (isProactive) {
      const decision = evaluateProactive(ctx.db, row.chat_id, ctx.config.proactive, Date.now(), tz);
      if (!decision.allowed) {
        if (decision.reason === 'chat_blocked') {
          markOutboxCancelled(ctx.db, row.id);
          cancelled++;
        } else {
          // Soft defer — leave pending; next drain re-evaluates.
          deferred++;
        }
        continue;
      }
    }

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
      if (isProactive) {
        recordProactiveSend(ctx.db, row.chat_id, Date.now(), tz);
      }
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Telegram's 403 "Forbidden: bot was blocked by the user" → flip the
      // chat to blocked so we stop trying. Treat as cancelled, not failed.
      if (/403|blocked by the user|chat not found/i.test(message)) {
        setChatBlocked(ctx.db, row.chat_id, 1);
        markOutboxCancelled(ctx.db, row.id);
        cancelled++;
      } else {
        markOutboxFailed(ctx.db, row.id, message);
        failed++;
      }
    }
  }

  return { attempted: pending.length, sent, failed, deferred, cancelled };
}
