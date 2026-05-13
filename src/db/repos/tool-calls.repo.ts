/**
 * Repository for the `tool_calls` table.
 *
 * The orchestrator inserts one row per tool invocation. `insertToolCallStart`
 * runs when the provider emits `tool_call`; `markToolCallEnd` runs when the
 * provider emits the matching `tool_result` (or an error mid-stream).
 *
 * The provider's `callId` is the foreign reference the orchestrator maps to
 * the row id; we generate our own ULID for `id` to stay consistent with the
 * rest of the schema.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';
import type { ToolSource } from '../../tools/tool.js';

/** A row from the `tool_calls` table. */
export interface ToolCallRow {
  id: string;
  run_id: string;
  tool_name: string;
  source: ToolSource;
  input_json: string;
  result_json: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** Input to `insertToolCallStart()`. */
export interface ToolCallStartInput {
  run_id: string;
  tool_name: string;
  source: ToolSource;
  input_json: string;
}

/**
 * Insert a `tool_calls` row in its "started" state (no result yet).
 *
 * @param db - Open SQLite handle.
 * @param input - Run + tool metadata.
 * @returns The generated row id (use to match the later `tool_result`).
 */
export function insertToolCallStart(db: Db, input: ToolCallStartInput): string {
  const id = ulid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tool_calls (id, run_id, tool_name, source, input_json, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.run_id, input.tool_name, input.source, input.input_json, now);
  return id;
}

/** Result outcome for `markToolCallEnd()`. */
export interface ToolCallEndInput {
  result_json: string | null;
  error: string | null;
}

/**
 * Update a started row with its terminal result (or error).
 *
 * @param db - Open SQLite handle.
 * @param id - Row id returned by `insertToolCallStart()`.
 * @param input - Result JSON and/or error text.
 */
export function markToolCallEnd(db: Db, id: string, input: ToolCallEndInput): void {
  const now = new Date().toISOString();
  db.prepare(`UPDATE tool_calls SET result_json = ?, error = ?, finished_at = ? WHERE id = ?`).run(
    input.result_json,
    input.error,
    now,
    id,
  );
}
