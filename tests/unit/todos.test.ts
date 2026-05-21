/**
 * TODO store unit tests. Use a tmp dir override so the real workspace
 * (`~/.mvpclaw/workspaces/default/`) is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { todoAdd, todoDone, todoList } from '../../src/todos/todos-store.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-todos-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('todos-store — add', () => {
  it('appends a row with ULID + ISO timestamp + source + text', () => {
    const row = todoAdd('reply to Patrick', 'email', tmp);
    expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row.source).toBe('email');
    expect(row.text).toBe('reply to Patrick');
    const onDisk = readFileSync(join(tmp, 'TODO.md'), 'utf8');
    expect(onDisk).toMatch(/^- \[/);
    expect(onDisk).toContain('[email]');
    expect(onDisk).toContain('reply to Patrick');
  });

  it('rejects empty / overlong / multi-line text', () => {
    expect(() => todoAdd('', 'manual', tmp)).toThrow(/1\.\./);
    expect(() => todoAdd('x'.repeat(500), 'manual', tmp)).toThrow(/1\.\./);
    expect(() => todoAdd('a\nb', 'manual', tmp)).toThrow(/single line/);
  });

  it('rejects unknown source', () => {
    expect(() => todoAdd('x', 'invalid' as never, tmp)).toThrow(/unknown source/);
  });
});

describe('todos-store — list / done', () => {
  it('lists open todos in append order, ignoring DONE entries', () => {
    todoAdd('first', 'manual', tmp);
    todoAdd('second', 'scheduler', tmp);
    const open = todoList('open', tmp);
    expect(open).toHaveLength(2);
    expect(open[0]?.text).toBe('first');
    expect(open[1]?.text).toBe('second');
  });

  it('todoDone moves a row from TODO.md to DONE-TASKS.md with done@ marker', () => {
    const a = todoAdd('finish report', 'manual', tmp);
    todoAdd('email Patrick', 'email', tmp);
    const done = todoDone(a.id, 'shipped via Cloudflare', tmp);
    expect(done?.id).toBe(a.id);
    expect(done?.note).toBe('shipped via Cloudflare');
    expect(done?.doneAt).toMatch(/^\d{4}-/);
    const open = todoList('open', tmp);
    expect(open).toHaveLength(1);
    expect(open[0]?.text).toBe('email Patrick');
    const finished = todoList('done', tmp);
    expect(finished).toHaveLength(1);
    expect(finished[0]?.id).toBe(a.id);
  });

  it('todoDone on missing id returns undefined', () => {
    expect(todoDone('00000000000000000000000000', undefined, tmp)).toBeUndefined();
  });

  it('DONE-TASKS.md retains rows across multiple completions', () => {
    const a = todoAdd('one', 'manual', tmp);
    const b = todoAdd('two', 'manual', tmp);
    todoDone(a.id, undefined, tmp);
    todoDone(b.id, 'note for b', tmp);
    const done = todoList('done', tmp);
    expect(done).toHaveLength(2);
    const ids = done.map((d) => d.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });
});
