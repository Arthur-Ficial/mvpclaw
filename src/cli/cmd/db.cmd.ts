/**
 * `mvpclaw db` — query (read-only) / migrate / vacuum / dump the SQLite database.
 *
 * `db migrate` is implemented here (Phase 2 / P2) because the rest of the
 * build needs to be able to apply migrations. The full read-only `db query`,
 * `db vacuum`, and `db dump` arrive in ticket C10 (#34).
 */
import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { loadConfig } from '../../config/index.js';
import { applyMigrations, openDb, pathFromUrl } from '../../db/index.js';
import { exitConfig, exitRuntime } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs, notYetImplemented } from './_common.js';

/**
 * Sub-command: `mvpclaw db migrate` — apply any pending migrations from
 * `./migrations/` against the configured SQLite database. Idempotent.
 */
const migrateSubCmd = defineCommand({
  meta: { name: 'migrate', description: 'Apply pending SQL migrations. Idempotent.' },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let dbPath: string;
    try {
      const config = loadConfig(args.config);
      dbPath = pathFromUrl(config.database.url);
    } catch (e) {
      exitConfig(e instanceof Error ? e.message : String(e));
    }
    try {
      const db = openDb(dbPath);
      const migrationsDir = resolve(process.cwd(), 'migrations');
      const applied = applyMigrations(db, migrationsDir);
      db.close();
      writeOut({ ok: true, dbPath, applied, appliedCount: applied.length }, ctx);
    } catch (e) {
      exitRuntime(e instanceof Error ? e.message : String(e));
    }
  },
});

export const dbCmd = defineCommand({
  meta: {
    name: 'db',
    description: 'Query (read-only) / migrate / vacuum / dump the SQLite database.',
  },
  args: { ...commonArgs },
  subCommands: {
    migrate: migrateSubCmd,
    // query / vacuum / dump land in C10 / #34
    query: defineCommand({
      meta: { name: 'query', description: 'Run a read-only SQL query (C10 / #34).' },
      args: { ...commonArgs },
      run: () => notYetImplemented('db query', 'C10 / #34'),
    }),
    vacuum: defineCommand({
      meta: { name: 'vacuum', description: 'Run SQLite VACUUM (C10 / #34).' },
      args: { ...commonArgs },
      run: () => notYetImplemented('db vacuum', 'C10 / #34'),
    }),
    dump: defineCommand({
      meta: { name: 'dump', description: 'Dump the database to a file (C10 / #34).' },
      args: { ...commonArgs },
      run: () => notYetImplemented('db dump', 'C10 / #34'),
    }),
  },
});
