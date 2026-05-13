/**
 * Repo-level test that `enqueueOutbox` correctly stamps `is_proactive`
 * based on its input. This pins the behaviour introduced in
 * migration 0006_outbox_is_proactive.sql: before this column existed,
 * `drainOutbox` used `run_id IS NULL` as a proxy for "proactive", which
 * mis-gated /help slash-command replies.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, applyMigrations } from '../../src/db/index.js';
import { enqueueOutbox } from '../../src/db/repos/outbox.repo.js';

function freshDb(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  applyMigrations(db, resolve(__dirname, '../../migrations'));
  db.exec(`INSERT INTO chats (id, provider, provider_chat_id, type, created_at, updated_at)
           VALUES ('chat1', 'telegram', '1234567890', 'private', '2026-01-01', '2026-01-01')`);
  return db;
}

describe('outbox.is_proactive', () => {
  it('defaults to 0 when is_proactive is not passed (reactive reply)', () => {
    const db = freshDb();
    const row = enqueueOutbox(db, {
      chat_id: 'chat1',
      provider: 'telegram',
      provider_chat_id: '1234567890',
      kind: 'text',
      text: 'reactive reply',
    });
    expect(row.is_proactive).toBe(0);
    const stored = db.prepare('SELECT is_proactive FROM outbox WHERE id = ?').get(row.id) as {
      is_proactive: number;
    };
    expect(stored.is_proactive).toBe(0);
  });

  it('persists is_proactive=1 when explicitly set (scheduler-driven outreach)', () => {
    const db = freshDb();
    const row = enqueueOutbox(db, {
      chat_id: 'chat1',
      provider: 'telegram',
      provider_chat_id: '1234567890',
      kind: 'text',
      text: 'good morning!',
      is_proactive: true,
    });
    expect(row.is_proactive).toBe(1);
    const stored = db.prepare('SELECT is_proactive FROM outbox WHERE id = ?').get(row.id) as {
      is_proactive: number;
    };
    expect(stored.is_proactive).toBe(1);
  });

  it('REGRESSION: a row with run_id=null but is_proactive=0 is reactive (the /help case)', () => {
    // This is the bug we fixed: before migration 0006, drainOutbox treated
    // any run_id=null row as proactive. With is_proactive=0 (default) such a
    // row is now correctly classified as reactive.
    const db = freshDb();
    const row = enqueueOutbox(db, {
      chat_id: 'chat1',
      run_id: null,
      provider: 'telegram',
      provider_chat_id: '1234567890',
      kind: 'text',
      text: 'Available commands:\n/start /help /status',
    });
    expect(row.run_id).toBeNull();
    expect(row.is_proactive).toBe(0); // ← the fix
  });
});
