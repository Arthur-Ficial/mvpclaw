/**
 * Repo round-trip tests for `tool_calls` — pins the contract introduced in
 * commit 0d5007f (T-004). Before that commit the table existed in the
 * schema but no code wrote to it. These tests would have caught the gap.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, applyMigrations } from '../../src/db/index.js';
import { insertToolCallStart, markToolCallEnd } from '../../src/db/repos/tool-calls.repo.js';

function freshDb(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  applyMigrations(db, resolve(__dirname, '../../migrations'));
  // Satisfy FK: tool_calls.run_id → agent_runs(id). Insert a stub run.
  db.exec(`INSERT INTO chats (id, provider, provider_chat_id, type, created_at, updated_at)
           VALUES ('chat1', 'test', 'test-1', 'private', '2026-01-01', '2026-01-01')`);
  db.exec(`INSERT INTO sessions (id, chat_id, status, created_at, updated_at)
           VALUES ('sess1', 'chat1', 'active', '2026-01-01', '2026-01-01')`);
  db.exec(`INSERT INTO messages (id, session_id, direction, provider, text, created_at)
           VALUES ('msg1', 'sess1', 'inbound', 'test', 'hi', '2026-01-01')`);
  db.exec(`INSERT INTO agent_runs (id, session_id, input_message_id, provider, status, trace_path, started_at)
           VALUES ('run1', 'sess1', 'msg1', 'openrouter', 'running', '/tmp/x', '2026-01-01')`);
  return db;
}

describe('tool_calls repo', () => {
  it('insertToolCallStart returns a fresh ulid and persists the row in non-finished state', () => {
    const db = freshDb();
    const id = insertToolCallStart(db, {
      run_id: 'run1',
      tool_name: 'read_file',
      source: 'builtin',
      input_json: '{"path":"/etc/hosts"}',
    });
    expect(id).toMatch(/^[0-9A-Z]{26}$/); // ulid shape
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    expect(row['run_id']).toBe('run1');
    expect(row['tool_name']).toBe('read_file');
    expect(row['source']).toBe('builtin');
    expect(row['input_json']).toBe('{"path":"/etc/hosts"}');
    expect(row['result_json']).toBeNull();
    expect(row['error']).toBeNull();
    expect(row['started_at']).toBeTruthy();
    expect(row['finished_at']).toBeNull();
  });

  it('markToolCallEnd writes result_json + finished_at for a success', () => {
    const db = freshDb();
    const id = insertToolCallStart(db, {
      run_id: 'run1',
      tool_name: 'mvpclaw_datetime',
      source: 'builtin',
      input_json: '{}',
    });
    markToolCallEnd(db, id, {
      result_json: '{"iso":"2026-05-13T00:00:00Z"}',
      error: null,
    });
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    expect(row['result_json']).toBe('{"iso":"2026-05-13T00:00:00Z"}');
    expect(row['error']).toBeNull();
    expect(row['finished_at']).toBeTruthy();
  });

  it('markToolCallEnd writes error column for a failed call', () => {
    const db = freshDb();
    const id = insertToolCallStart(db, {
      run_id: 'run1',
      tool_name: 'gemini_image',
      source: 'builtin',
      input_json: '{"prompt":"x"}',
    });
    markToolCallEnd(db, id, { result_json: null, error: 'OPENROUTER 401' });
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    expect(row['error']).toBe('OPENROUTER 401');
    expect(row['result_json']).toBeNull();
    expect(row['finished_at']).toBeTruthy();
  });
});
