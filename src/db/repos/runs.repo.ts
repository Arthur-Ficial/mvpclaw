/**
 * Repository for the `agent_runs` table.
 *
 * Every inbound message that triggers the agent creates exactly one
 * `agent_runs` row. Status transitions: queued → running → succeeded | failed.
 * The `trace_path` points at `data/traces/<runId>.jsonl` — every run is
 * replayable without Telegram.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';

/** A row from the `agent_runs` table. */
export interface AgentRunRow {
  id: string;
  session_id: string;
  input_message_id: string;
  provider: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  trace_path: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

/** Input for `createRun()`. */
export interface AgentRunCreate {
  session_id: string;
  input_message_id: string;
  provider: string;
  trace_path: string;
}

/**
 * Create a new agent_runs row in `queued` state.
 *
 * @param db - The open SQLite handle.
 * @param input - The session, message, provider, and trace path.
 * @returns The created row.
 */
export function createRun(db: Db, input: AgentRunCreate): AgentRunRow {
  const id = ulid();
  db.prepare(
    `INSERT INTO agent_runs (id, session_id, input_message_id, provider, status, trace_path)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
  ).run(id, input.session_id, input.input_message_id, input.provider, input.trace_path);
  return {
    id,
    session_id: input.session_id,
    input_message_id: input.input_message_id,
    provider: input.provider,
    status: 'queued',
    trace_path: input.trace_path,
    started_at: null,
    finished_at: null,
    error: null,
  };
}

/**
 * Transition a run from `queued` to `running` (sets `started_at`).
 *
 * @param db - The open SQLite handle.
 * @param runId - The run to start.
 */
export function markRunRunning(db: Db, runId: string): void {
  db.prepare("UPDATE agent_runs SET status = 'running', started_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    runId,
  );
}

/**
 * Transition a run to `succeeded` (sets `finished_at`).
 *
 * @param db - The open SQLite handle.
 * @param runId - The run that completed.
 */
export function markRunSucceeded(db: Db, runId: string): void {
  db.prepare("UPDATE agent_runs SET status = 'succeeded', finished_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    runId,
  );
}

/**
 * Transition a run to `failed` with an error message.
 *
 * @param db - The open SQLite handle.
 * @param runId - The run that failed.
 * @param error - Human-readable error description.
 */
export function markRunFailed(db: Db, runId: string, error: string): void {
  db.prepare(
    "UPDATE agent_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
  ).run(new Date().toISOString(), error, runId);
}

/**
 * Look up a run by id.
 *
 * @param db - The open SQLite handle.
 * @param id - The run's ULID.
 * @returns The row, or `undefined` if not found.
 */
export function findRunById(db: Db, id: string): AgentRunRow | undefined {
  return db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined;
}
