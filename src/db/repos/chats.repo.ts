/**
 * Repository for the `chats` table.
 *
 * Each "chat" is a (provider, provider_chat_id, thread_id?) triple. The
 * `id` is a project-scoped ULID; external IDs from Telegram/Discord/etc.
 * live in `provider_chat_id`.
 *
 * Operations are tiny prepared statements — no business logic here. Use
 * the orchestrator (src/app/) for chat-lifecycle decisions.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';

/** A row from the `chats` table, as TypeScript sees it. */
export interface ChatRow {
  id: string;
  provider: string;
  provider_chat_id: string;
  thread_id: string | null;
  type: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

/** Input for `upsertChat()`. The repo fills in id, timestamps. */
export interface ChatUpsert {
  provider: string;
  provider_chat_id: string;
  thread_id?: string | null;
  type: string;
  title?: string | null;
}

/**
 * Insert a new chat row, or return the existing row if the
 * (provider, provider_chat_id, thread_id) triple is already present.
 *
 * @param db - The open SQLite handle.
 * @param input - The chat-identity triple plus type/title.
 * @returns The persisted row (existing or newly inserted).
 */
export function upsertChat(db: Db, input: ChatUpsert): ChatRow {
  const existing = db
    .prepare(
      `SELECT * FROM chats
       WHERE provider = ? AND provider_chat_id = ?
         AND (thread_id IS ? OR thread_id = ?)`,
    )
    .get(input.provider, input.provider_chat_id, input.thread_id ?? null, input.thread_id ?? null);
  if (existing) {
    return existing as ChatRow;
  }
  const now = new Date().toISOString();
  const id = ulid();
  db.prepare(
    `INSERT INTO chats (id, provider, provider_chat_id, thread_id, type, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.provider,
    input.provider_chat_id,
    input.thread_id ?? null,
    input.type,
    input.title ?? null,
    now,
    now,
  );
  return {
    id,
    provider: input.provider,
    provider_chat_id: input.provider_chat_id,
    thread_id: input.thread_id ?? null,
    type: input.type,
    title: input.title ?? null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch a chat row by its internal ULID.
 *
 * @param db - The open SQLite handle.
 * @param id - The chat's internal ULID.
 * @returns The row, or `undefined` if no chat with that id exists.
 */
export function findChatById(db: Db, id: string): ChatRow | undefined {
  return db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatRow | undefined;
}

/**
 * List the most recent chats by `updated_at` (descending).
 *
 * @param db - The open SQLite handle.
 * @param limit - Maximum number of rows to return.
 * @returns Recent chat rows, most recently updated first.
 */
export function listChats(db: Db, limit = 50): ChatRow[] {
  return db.prepare('SELECT * FROM chats ORDER BY updated_at DESC LIMIT ?').all(limit) as ChatRow[];
}
