/**
 * Repository for the `messages` table.
 *
 * Inbound (from channel → bot) and outbound (bot → channel) messages live
 * in the same table, differentiated by the `direction` column. The
 * `(provider, provider_update_id)` UNIQUE constraint is the dedup guarantee:
 * the same Telegram update arriving twice produces no second agent run.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';

/** A row from the `messages` table. */
export interface MessageRow {
  id: string;
  session_id: string;
  direction: 'inbound' | 'outbound';
  provider: string;
  provider_message_id: string | null;
  provider_update_id: string | null;
  sender_id: string | null;
  text: string;
  raw_json: string | null;
  created_at: string;
}

/** Input for inserting a new message. */
export interface MessageInsert {
  session_id: string;
  direction: 'inbound' | 'outbound';
  provider: string;
  provider_message_id?: string | null;
  provider_update_id?: string | null;
  sender_id?: string | null;
  text: string;
  raw_json?: string | null;
}

/**
 * Insert a message row. If `provider_update_id` collides with an existing
 * row, the insert is a no-op and the existing row is returned.
 *
 * @param db - The open SQLite handle.
 * @param input - The message to insert.
 * @returns `{ row, inserted }` — `inserted` is false when dedup hit.
 */
export function insertMessage(
  db: Db,
  input: MessageInsert,
): { row: MessageRow; inserted: boolean } {
  if (input.provider_update_id) {
    const existing = db
      .prepare('SELECT * FROM messages WHERE provider = ? AND provider_update_id = ?')
      .get(input.provider, input.provider_update_id) as MessageRow | undefined;
    if (existing) {
      return { row: existing, inserted: false };
    }
  }
  const id = ulid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages
       (id, session_id, direction, provider, provider_message_id, provider_update_id, sender_id, text, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.session_id,
    input.direction,
    input.provider,
    input.provider_message_id ?? null,
    input.provider_update_id ?? null,
    input.sender_id ?? null,
    input.text,
    input.raw_json ?? null,
    now,
  );
  return {
    row: {
      id,
      session_id: input.session_id,
      direction: input.direction,
      provider: input.provider,
      provider_message_id: input.provider_message_id ?? null,
      provider_update_id: input.provider_update_id ?? null,
      sender_id: input.sender_id ?? null,
      text: input.text,
      raw_json: input.raw_json ?? null,
      created_at: now,
    },
    inserted: true,
  };
}

/**
 * Fetch the most recent N messages in a session, oldest first.
 *
 * @param db - The open SQLite handle.
 * @param sessionId - The session whose history to load.
 * @param limit - Maximum number of messages to return.
 * @returns Messages ordered by `created_at` ascending.
 */
export function recentMessages(db: Db, sessionId: string, limit: number): MessageRow[] {
  // Tiebreaker is SQLite's internal `rowid` — strictly insertion-ordered per
  // table, immune to ULID-within-the-same-millisecond non-monotonicity.
  // Reverse so callers get chronological order.
  const rows = db
    .prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    )
    .all(sessionId, limit) as MessageRow[];
  return rows.reverse();
}

/** Aggregate message activity, optionally scoped to one provider (e.g. telegram). */
export interface MessageStats {
  /** Total messages stored (inbound + outbound). */
  total: number;
  /** Messages received from the channel (direction = 'inbound'). */
  received: number;
  /** Messages sent to the channel (direction = 'outbound'). */
  sent: number;
  /** ISO timestamp of the most recent message, or null when there are none. */
  lastAt: string | null;
}

/**
 * Compute received/sent/total counts and the last-activity timestamp.
 *
 * @param db - The open SQLite handle.
 * @param provider - Optional channel filter (e.g. `'telegram'`). Omit for all.
 * @returns A {@link MessageStats} snapshot.
 */
export function messageStats(db: Db, provider?: string): MessageStats {
  const where = provider ? 'WHERE provider = ?' : '';
  const params = provider ? [provider] : [];
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(direction = 'inbound'), 0) AS received,
         COALESCE(SUM(direction = 'outbound'), 0) AS sent,
         MAX(created_at) AS lastAt
       FROM messages ${where}`,
    )
    .get(...params) as { total: number; received: number; sent: number; lastAt: string | null };
  return {
    total: row.total,
    received: row.received,
    sent: row.sent,
    lastAt: row.lastAt ?? null,
  };
}
