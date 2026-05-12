/**
 * Repository for the `chat_memory` + `chat_memory_archive` tables.
 *
 * Tiny prepared statements only. Rotation policy lives in `src/memory/`.
 */
import type { Db } from '../db.js';

/** A row from the `chat_memory` table. */
export interface ChatMemoryRow {
  chat_id: string;
  body: string;
  size_bytes: number;
  updated_at: number;
}

/**
 * Read the per-chat memory for `chat_id` (empty string when no row exists).
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @returns The stored body, or empty string if no row.
 */
export function readChatMemory(db: Db, chat_id: string): string {
  const row = db.prepare('SELECT body FROM chat_memory WHERE chat_id = ?').get(chat_id) as
    | { body: string }
    | undefined;
  return row?.body ?? '';
}

/**
 * Append `text` to the per-chat memory body. Atomic: replaces the row in
 * a single UPSERT. Returns the new body.
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @param text - Text to append (pre-redacted by the caller).
 * @returns The new body.
 */
export function appendChatMemory(db: Db, chat_id: string, text: string): string {
  const existing = readChatMemory(db, chat_id);
  const body = existing + text;
  db.prepare(
    `INSERT INTO chat_memory (chat_id, body, size_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET body = excluded.body, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`,
  ).run(chat_id, body, Buffer.byteLength(body, 'utf8'), Date.now());
  return body;
}

/**
 * Replace the per-chat memory body wholesale (used by `mvpclaw memory clear`
 * or `mvpclaw memory edit`).
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @param body - New body (may be empty).
 */
export function setChatMemory(db: Db, chat_id: string, body: string): void {
  db.prepare(
    `INSERT INTO chat_memory (chat_id, body, size_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET body = excluded.body, size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`,
  ).run(chat_id, body, Buffer.byteLength(body, 'utf8'), Date.now());
}

/**
 * Move the current body to the archive table and clear the active row.
 * Used by rotation when `size_bytes` exceeds the cap.
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @returns The archive row id, or null when there was nothing to archive.
 */
export function archiveChatMemory(db: Db, chat_id: string): number | null {
  const body = readChatMemory(db, chat_id);
  if (body.length === 0) {
    return null;
  }
  const r = db
    .prepare('INSERT INTO chat_memory_archive (chat_id, body, archived_at) VALUES (?, ?, ?)')
    .run(chat_id, body, Date.now());
  setChatMemory(db, chat_id, '');
  return Number(r.lastInsertRowid);
}

/** List archive rows for a chat (most recent first). */
export function listArchive(
  db: Db,
  chat_id: string,
  limit = 20,
): Array<{ id: number; archived_at: number; size_bytes: number }> {
  return db
    .prepare(
      'SELECT id, archived_at, LENGTH(body) AS size_bytes FROM chat_memory_archive WHERE chat_id = ? ORDER BY archived_at DESC LIMIT ?',
    )
    .all(chat_id, limit) as Array<{ id: number; archived_at: number; size_bytes: number }>;
}
