/**
 * Repository for the `tasks` table.
 *
 * Tiny prepared statements only. Lifecycle state machine + dispatcher
 * logic lives in `src/scheduler/`.
 */
import { ulid } from 'ulid';
import type { Db } from '../db.js';

/** Task lifecycle states (spec §26.5). */
export type TaskState =
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dead'
  | 'cancelled'
  | 'paused';

/** A row from the `tasks` table. */
export interface TaskRow {
  id: string;
  chat_id: string;
  created_by: string;
  kind: 'one_shot' | 'recurring';
  cron_expr: string | null;
  timezone: string;
  next_run_at: number;
  last_run_at: number | null;
  prompt: string;
  skill: string | null;
  state: TaskState;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  catchup_policy: 'run_once' | 'run_all_missed' | 'skip';
  lease_owner: string | null;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
}

/** Input for `insertTask()`. */
export interface TaskInsert {
  chat_id: string;
  created_by: 'user' | 'agent' | 'system';
  kind: 'one_shot' | 'recurring';
  cron_expr?: string | null;
  timezone?: string;
  next_run_at: number;
  prompt: string;
  skill?: string | null;
  catchup_policy?: 'run_once' | 'run_all_missed' | 'skip';
  max_attempts?: number;
}

/**
 * Insert a new task in `scheduled` state.
 *
 * @param db - Open SQLite handle.
 * @param input - The task to schedule.
 * @returns The persisted row.
 */
export function insertTask(db: Db, input: TaskInsert): TaskRow {
  const id = ulid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO tasks (id, chat_id, created_by, kind, cron_expr, timezone, next_run_at,
                        prompt, skill, state, attempts, max_attempts, catchup_policy,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0, ?, ?, ?, ?)`,
  ).run(
    id,
    input.chat_id,
    input.created_by,
    input.kind,
    input.cron_expr ?? null,
    input.timezone ?? 'Europe/Vienna',
    input.next_run_at,
    input.prompt,
    input.skill ?? null,
    input.max_attempts ?? 3,
    input.catchup_policy ?? 'run_once',
    now,
    now,
  );
  return findTaskById(db, id) as TaskRow;
}

/** Fetch a task by id. */
export function findTaskById(db: Db, id: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
}

/** Count tasks for a chat in a given state. */
export function countTasksByChat(db: Db, chat_id: string, state?: TaskState): number {
  const sql =
    state === undefined
      ? 'SELECT COUNT(*) AS c FROM tasks WHERE chat_id = ?'
      : 'SELECT COUNT(*) AS c FROM tasks WHERE chat_id = ? AND state = ?';
  const args = state === undefined ? [chat_id] : [chat_id, state];
  return (db.prepare(sql).get(...args) as { c: number }).c;
}

/** Filters for `listTasks()`. */
export interface TaskListFilters {
  chat_id?: string | undefined;
  state?: TaskState | undefined;
  limit?: number | undefined;
}

/** List tasks ordered by `next_run_at` ascending. */
export function listTasks(db: Db, filters: TaskListFilters = {}): TaskRow[] {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (filters.chat_id !== undefined) {
    clauses.push('chat_id = ?');
    args.push(filters.chat_id);
  }
  if (filters.state !== undefined) {
    clauses.push('state = ?');
    args.push(filters.state);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  args.push(filters.limit ?? 100);
  return db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY next_run_at ASC LIMIT ?`)
    .all(...args) as TaskRow[];
}

/**
 * Atomically transition a task `scheduled → running` (P12's dispatcher).
 *
 * @returns `true` if this caller won the lease; `false` if another did.
 */
export function claimTask(db: Db, id: string, leaseOwner: string, leaseTtlMs: number): boolean {
  const now = Date.now();
  const r = db
    .prepare(
      "UPDATE tasks SET state = 'running', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'scheduled'",
    )
    .run(leaseOwner, now + leaseTtlMs, now, id);
  return r.changes === 1;
}

/** Mark a task `completed` (one-shot success). */
export function markTaskCompleted(db: Db, id: string): void {
  db.prepare(
    "UPDATE tasks SET state = 'completed', last_run_at = ?, updated_at = ? WHERE id = ?",
  ).run(Date.now(), Date.now(), id);
}

/** Recurring success → return to `scheduled` with the next run time computed by croner. */
export function markTaskRescheduled(db: Db, id: string, nextRunAt: number): void {
  db.prepare(
    "UPDATE tasks SET state = 'scheduled', last_run_at = ?, next_run_at = ?, lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?",
  ).run(Date.now(), nextRunAt, Date.now(), id);
}

/** Mark a task `failed`. The dispatcher decides whether to retry or kill. */
export function markTaskFailed(db: Db, id: string, error: string): void {
  db.prepare("UPDATE tasks SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(
    error,
    Date.now(),
    id,
  );
}

/** Cancel a task (terminal). */
export function markTaskCancelled(db: Db, id: string): void {
  db.prepare("UPDATE tasks SET state = 'cancelled', updated_at = ? WHERE id = ?").run(
    Date.now(),
    id,
  );
}

/** Pause / resume — toggleable. */
export function setTaskPaused(db: Db, id: string, paused: boolean): void {
  const target: TaskState = paused ? 'paused' : 'scheduled';
  db.prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?').run(target, Date.now(), id);
}

/**
 * On startup, reset any `running` rows whose lease expired back to `scheduled`.
 * Called from `Scheduler.recover()`. Returns the count of rows reset.
 */
export function recoverLeases(db: Db, now: number = Date.now()): number {
  const r = db
    .prepare(
      "UPDATE tasks SET state = 'scheduled', lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE state = 'running' AND (lease_until IS NULL OR lease_until < ?)",
    )
    .run(now, now);
  return r.changes;
}
