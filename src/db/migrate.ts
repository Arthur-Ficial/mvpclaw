/**
 * Migration runner.
 *
 * Reads `migrations/NNNN_*.sql` files in lexical order and applies any that
 * are not already recorded in the `schema_migrations` table. Each migration
 * runs inside a transaction so partial application is impossible.
 *
 * The runner is idempotent: re-running it with no pending migrations is a
 * no-op (returns 0 applied). The `schema_migrations` table is created on
 * the fly if missing (bootstrap path on a fresh DB).
 *
 * Migration ID is the filename without the `.sql` extension.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';

/**
 * Apply pending migrations from `migrationsDir` against `db`.
 *
 * @param db - The open SQLite handle.
 * @param migrationsDir - Path to the directory containing `NNNN_*.sql` files.
 * @returns The IDs of migrations applied during this call (lexically sorted).
 */
export function applyMigrations(db: Db, migrationsDir: string): string[] {
  // Bootstrap: create the tracking table if it doesn't exist yet.
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id          TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
  )`);

  if (!existsSync(migrationsDir)) {
    return [];
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const seen = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((r) => (r as { id: string }).id),
  );

  const applied: string[] = [];
  for (const filename of files) {
    const id = filename.replace(/\.sql$/, '');
    if (seen.has(id)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, filename), 'utf8');
    const now = new Date().toISOString();
    const txn = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, now);
    });
    txn();
    applied.push(id);
  }
  return applied;
}
