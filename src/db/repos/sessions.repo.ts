/**
 * Repository for the `sessions` table.
 *
 * A session is the agent's conversational context within a single chat.
 * `/new` (and the upcoming `mvpclaw chat reset` CLI) terminate the current
 * session and start a fresh one; messages from older sessions remain in
 * SQLite for traceability but are not sent to the provider.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';

/** A row from the `sessions` table. */
export interface SessionRow {
  id: string;
  chat_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Return the currently-active session for a chat, or create one if none.
 *
 * @param db - The open SQLite handle.
 * @param chatId - Internal ULID of the parent chat.
 * @returns The active session row (existing or newly created).
 */
export function getOrCreateActiveSession(db: Db, chatId: string): SessionRow {
  const existing = db
    .prepare(
      "SELECT * FROM sessions WHERE chat_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    )
    .get(chatId) as SessionRow | undefined;
  if (existing) {
    return existing;
  }
  const now = new Date().toISOString();
  const id = ulid();
  db.prepare(
    `INSERT INTO sessions (id, chat_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`,
  ).run(id, chatId, now, now);
  return { id, chat_id: chatId, status: 'active', created_at: now, updated_at: now };
}

/**
 * Close the currently-active session for a chat (used by `/new` / reset).
 *
 * @param db - The open SQLite handle.
 * @param chatId - Internal ULID of the parent chat.
 * @returns Number of sessions transitioned to `closed`.
 */
export function closeActiveSessions(db: Db, chatId: string): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE sessions SET status = 'closed', updated_at = ? WHERE chat_id = ? AND status = 'active'",
    )
    .run(now, chatId);
  return result.changes;
}
