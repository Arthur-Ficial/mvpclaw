/**
 * Single SQLite connection factory.
 *
 * Opens the database with the project's invariants (per ARCHITECTURE.md §9):
 *   - WAL journal mode (concurrent reads + faster writes)
 *   - synchronous=NORMAL (durable enough for single-process; faster than FULL)
 *   - foreign_keys=ON (the schema declares FKs; enforce them at runtime)
 *
 * There is exactly ONE place in the codebase that opens a connection:
 * `openDb()`. All other modules receive a `Db` instance via AppContext.
 *
 * The driver is `better-sqlite3` — synchronous, prepared-statement first,
 * no callbacks. Picked for readability ("a junior dev can read this in
 * 30 minutes") over Drizzle's chained query builder.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/**
 * Open the SQLite database at `path`, ensuring parent dirs exist, and apply
 * the project pragmas. Returns the underlying `better-sqlite3` instance.
 *
 * @param path - Filesystem path to the SQLite file. `:memory:` is allowed.
 * @returns An open database handle ready for queries.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Resolve the SQLite file path from a `database.url` config value.
 * Accepts the spec's `file:./data/mvpclaw.sqlite` form OR a bare path.
 *
 * @param url - The configured URL (e.g. "file:./data/mvpclaw.sqlite").
 * @returns The filesystem path suitable for `openDb()`.
 */
export function pathFromUrl(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}
