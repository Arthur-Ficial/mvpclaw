import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyMigrations, openDb } from '../../src/db/index.js';

const MIGRATIONS = resolve(__dirname, '../../migrations');

describe('applyMigrations — bootstrap, idempotency, table presence', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-mig-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates schema_migrations on a fresh DB and applies all .sql files', () => {
    const db = openDb(join(tmp, 'mvpclaw.sqlite'));
    const applied = applyMigrations(db, MIGRATIONS);
    expect(applied.length).toBeGreaterThanOrEqual(2); // 0001_initial + 0002_indices
    expect(applied).toContain('0001_initial');
    expect(applied).toContain('0002_indices');

    // All 9 core tables exist.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const expected of [
      'agent_runs',
      'chats',
      'messages',
      'outbox',
      'schema_migrations',
      'sessions',
      'skills',
      'tool_calls',
      'users',
    ]) {
      expect(tables, `missing table: ${expected}`).toContain(expected);
    }
    db.close();
  });

  it('is idempotent — second run applies nothing', () => {
    const db = openDb(join(tmp, 'mvpclaw.sqlite'));
    const first = applyMigrations(db, MIGRATIONS);
    const second = applyMigrations(db, MIGRATIONS);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    // schema_migrations should have exactly the first-run rows.
    const count = (db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number })
      .c;
    expect(count).toBe(first.length);
    db.close();
  });

  it('enforces foreign_keys ON (FK violation rejected)', () => {
    const db = openDb(join(tmp, 'mvpclaw.sqlite'));
    applyMigrations(db, MIGRATIONS);
    expect(() =>
      db
        .prepare(
          `INSERT INTO sessions (id, chat_id, status, created_at, updated_at)
           VALUES ('s-1', 'no-such-chat', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });
});
