/**
 * `mvpclaw db` — query (read-only) / migrate / vacuum / dump the DB.
 *
 * `query` rejects any statement that isn't read-only by using
 * better-sqlite3's `Statement.readonly` flag. Mutating SQL → exit 1.
 */
import { defineCommand } from 'citty';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../config/index.js';
import { applyMigrations, openDb, pathFromUrl } from '../../db/index.js';
import { exitConfig, exitRuntime, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

function openConfiguredDb(configFlag: string | undefined): {
  db: ReturnType<typeof openDb>;
  path: string;
} {
  const config = loadConfig(configFlag);
  const path = pathFromUrl(config.database.url);
  return { db: openDb(path), path };
}

const migrateCmd = defineCommand({
  meta: { name: 'migrate', description: 'Apply pending SQL migrations. Idempotent.' },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let opened;
    try {
      opened = openConfiguredDb(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    try {
      const applied = applyMigrations(opened.db, resolve(process.cwd(), 'migrations'));
      writeOut({ ok: true, dbPath: opened.path, applied, appliedCount: applied.length }, ctx);
    } catch (err) {
      exitRuntime(err instanceof Error ? err.message : String(err));
    } finally {
      opened.db.close();
    }
  },
});

const queryCmd = defineCommand({
  meta: {
    name: 'query',
    description: 'Run a read-only SQL query (SELECT / EXPLAIN only).',
  },
  args: {
    ...commonArgs,
    sql: { type: 'positional', description: 'SQL to run.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let opened;
    try {
      opened = openConfiguredDb(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    try {
      const stmt = opened.db.prepare(String(args.sql));
      if (!stmt.readonly) {
        exitUsage(
          "only read-only statements are accepted (SELECT / EXPLAIN). Use 'db migrate' for writes.",
        );
      }
      const rows = stmt.all();
      writeOut(rows, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('syntax')) {
        exitUsage(msg);
      }
      exitRuntime(msg);
    } finally {
      opened.db.close();
    }
  },
});

const vacuumCmd = defineCommand({
  meta: { name: 'vacuum', description: 'Run SQLite VACUUM.' },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let opened;
    try {
      opened = openConfiguredDb(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    try {
      opened.db.exec('VACUUM');
      writeOut({ ok: true, dbPath: opened.path }, ctx);
    } finally {
      opened.db.close();
    }
  },
});

const dumpCmd = defineCommand({
  meta: { name: 'dump', description: 'Dump every table as JSON to a file.' },
  args: {
    ...commonArgs,
    path: { type: 'positional', description: 'Output path.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let opened;
    try {
      opened = openConfiguredDb(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    try {
      const tables = opened.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => (r as { name: string }).name);
      const dump: Record<string, unknown[]> = {};
      for (const t of tables) {
        dump[t] = opened.db.prepare(`SELECT * FROM ${t}`).all();
      }
      writeFileSync(String(args.path), JSON.stringify(dump, null, 2) + '\n', 'utf8');
      writeOut({ ok: true, path: String(args.path), tables: tables.length }, ctx);
    } finally {
      opened.db.close();
    }
  },
});

export const dbCmd = defineCommand({
  meta: {
    name: 'db',
    description: 'Query (read-only) / migrate / vacuum / dump the SQLite database.',
  },
  args: { ...commonArgs },
  subCommands: { migrate: migrateCmd, query: queryCmd, vacuum: vacuumCmd, dump: dumpCmd },
});
