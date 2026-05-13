/**
 * Repository for the `outbox` table.
 *
 * Outbound messages are queued here in `pending`, picked up by the outbox
 * worker which transitions them through `sending` → `sent | failed | retrying`.
 * Per the spec, delivery is idempotent — running the worker twice on the
 * same row produces no double-send.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';

/** Outbox row statuses (state machine — see ARCHITECTURE.md §11). */
export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'retrying' | 'cancelled';

/** A row from the `outbox` table. */
export interface OutboxRow {
  id: string;
  chat_id: string;
  run_id: string | null;
  provider: string;
  provider_chat_id: string;
  provider_thread_id: string | null;
  kind: string;
  text: string;
  status: OutboxStatus;
  attempts: number;
  provider_message_id: string | null;
  is_proactive: 0 | 1;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  error: string | null;
}

/** Input for `enqueueOutbox()`. */
export interface OutboxEnqueue {
  chat_id: string;
  run_id?: string | null;
  provider: string;
  provider_chat_id: string;
  provider_thread_id?: string | null;
  kind: string;
  text: string;
  /**
   * True for scheduler-driven proactive outreach (subject to quiet-hours and
   * daily-cap gating). False for direct reactive replies to an inbound,
   * including slash-command replies that have `run_id=null`. Defaults to false.
   */
  is_proactive?: boolean;
}

/**
 * Enqueue a new outbound message in `pending` state.
 *
 * @param db - The open SQLite handle.
 * @param input - The outbound message.
 * @returns The persisted row.
 */
export function enqueueOutbox(db: Db, input: OutboxEnqueue): OutboxRow {
  const id = ulid();
  const now = new Date().toISOString();
  const isProactive: 0 | 1 = input.is_proactive === true ? 1 : 0;
  db.prepare(
    `INSERT INTO outbox
       (id, chat_id, run_id, provider, provider_chat_id, provider_thread_id, kind, text, status, attempts, is_proactive, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
  ).run(
    id,
    input.chat_id,
    input.run_id ?? null,
    input.provider,
    input.provider_chat_id,
    input.provider_thread_id ?? null,
    input.kind,
    input.text,
    isProactive,
    now,
    now,
  );
  return {
    id,
    chat_id: input.chat_id,
    run_id: input.run_id ?? null,
    provider: input.provider,
    provider_chat_id: input.provider_chat_id,
    provider_thread_id: input.provider_thread_id ?? null,
    kind: input.kind,
    text: input.text,
    status: 'pending',
    attempts: 0,
    provider_message_id: null,
    is_proactive: isProactive,
    created_at: now,
    updated_at: now,
    sent_at: null,
    error: null,
  };
}

/**
 * Atomically claim a `pending` row by transitioning it to `sending`.
 * Only succeeds if the row is still `pending` (changes() === 1).
 *
 * @param db - The open SQLite handle.
 * @param id - The outbox row id to claim.
 * @returns `true` if this caller won the race; `false` if another did.
 */
export function claimOutboxRow(db: Db, id: string): boolean {
  const result = db
    .prepare(
      "UPDATE outbox SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(new Date().toISOString(), id);
  return result.changes === 1;
}

/**
 * Mark an outbox row as successfully sent.
 *
 * @param db - The open SQLite handle.
 * @param id - The outbox row id.
 * @param providerMessageId - The id returned by the channel (for edits/replies).
 */
export function markOutboxSent(db: Db, id: string, providerMessageId: string | null): void {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE outbox SET status = 'sent', provider_message_id = ?, sent_at = ?, updated_at = ? WHERE id = ?",
  ).run(providerMessageId, now, now, id);
}

/**
 * Mark an outbox row as failed (with the error text).
 *
 * @param db - The open SQLite handle.
 * @param id - The outbox row id.
 * @param error - Human-readable failure description.
 */
export function markOutboxFailed(db: Db, id: string, error: string): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE outbox SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(
    error,
    now,
    id,
  );
}

/**
 * Mark an outbox row as cancelled (never to be sent).
 *
 * @param db - The open SQLite handle.
 * @param id - The outbox row id.
 */
export function markOutboxCancelled(db: Db, id: string): void {
  db.prepare("UPDATE outbox SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
}

/** Optional filters for `listOutbox()`. */
export interface OutboxListFilters {
  chat_id?: string | undefined;
  status?: OutboxStatus | undefined;
  limit?: number | undefined;
}

/**
 * List outbox rows, optionally filtered by chat and/or status.
 *
 * @param db - The open SQLite handle.
 * @param filters - Optional filters; `limit` defaults to 20.
 * @returns Rows ordered by `created_at` descending.
 */
export function listOutbox(db: Db, filters: OutboxListFilters = {}): OutboxRow[] {
  const limit = filters.limit ?? 20;
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (filters.chat_id !== undefined) {
    clauses.push('chat_id = ?');
    args.push(filters.chat_id);
  }
  if (filters.status !== undefined) {
    clauses.push('status = ?');
    args.push(filters.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  args.push(limit);
  return db
    .prepare(`SELECT * FROM outbox ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...args) as OutboxRow[];
}
