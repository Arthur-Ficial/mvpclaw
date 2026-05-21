/**
 * TODO store — append-only TODO.md / DONE-TASKS.md under the bot's runtime
 * workspace (`~/.mvpclaw/workspaces/default/`).
 *
 * Format, one row per todo:
 *
 *     `- [ULID] createdAt-ISO [source] text`
 *
 * `todoDone()` does NOT delete from TODO.md — it removes the matching line
 * and appends a corresponding row to DONE-TASKS.md with a `done@<ISO>`
 * marker. This is "moved", not "deleted", so the history of completed work
 * stays visible in DONE-TASKS.md indefinitely.
 *
 * Plain markdown is the point: the owner can `cat TODO.md` from any terminal,
 * and the bot's `bash_exec` (which `pwd`s into the workspace) can do the
 * same with no path prefix.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ulid } from 'ulid';

/** Allowed `source` tags. Identifies where a TODO came from. */
export const TODO_SOURCES = ['chat', 'email', 'scheduler', 'project', 'manual'] as const;
/** Source union type. */
export type TodoSource = (typeof TODO_SOURCES)[number];

/** Parsed shape of one TODO line. */
export interface TodoRow {
  id: string;
  createdAt: string;
  source: TodoSource;
  text: string;
}

/** Parsed shape of one DONE-TASKS line. */
export interface DoneRow extends TodoRow {
  doneAt: string;
  note?: string;
}

/** Resolve the workspace dir. Tests override. */
export function workspaceDir(override?: string): string {
  return override ?? join(homedir(), '.mvpclaw', 'workspaces', 'default');
}

/** Resolve `TODO.md`. */
export function todoPath(override?: string): string {
  return join(workspaceDir(override), 'TODO.md');
}

/** Resolve `DONE-TASKS.md`. */
export function donePath(override?: string): string {
  return join(workspaceDir(override), 'DONE-TASKS.md');
}

const LINE_RE = /^- \[([0-9A-HJKMNP-TV-Z]{26})\] (\S+) \[([\w-]+)\] (.+)$/;
const DONE_LINE_RE =
  /^- \[([0-9A-HJKMNP-TV-Z]{26})\] (\S+) \[([\w-]+)\] (.+?) — done@(\S+)(?: — note: (.+))?$/;

const MAX_TEXT = 280;

/**
 * Add a new TODO. Returns the persisted row.
 *
 * @param text - The todo text (≤280 chars).
 * @param source - Where it came from (defaults to 'manual').
 * @param override - Workspace dir override (tests).
 */
export function todoAdd(text: string, source: TodoSource = 'manual', override?: string): TodoRow {
  if (text.length === 0 || text.length > MAX_TEXT) {
    throw new Error(`todo_add: text must be 1..${MAX_TEXT} chars`);
  }
  if (!(TODO_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`todo_add: unknown source "${source}"`);
  }
  if (/\n/.test(text)) {
    throw new Error('todo_add: text must be a single line (no newlines)');
  }
  const row: TodoRow = {
    id: ulid(),
    createdAt: new Date().toISOString(),
    source,
    text,
  };
  const line = `- [${row.id}] ${row.createdAt} [${row.source}] ${row.text}\n`;
  const path = todoPath(override);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line, 'utf8');
  return row;
}

/**
 * Mark a TODO done. Removes the matching line from `TODO.md` and appends a
 * `DONE-TASKS.md` row with `done@<ISO>` and an optional note.
 *
 * @param id - The TODO's ULID.
 * @param note - Optional one-line completion note.
 * @param override - Workspace dir override (tests).
 * @returns The done-row, or `undefined` if no matching open TODO existed.
 */
export function todoDone(
  id: string,
  note: string | undefined,
  override?: string,
): DoneRow | undefined {
  if (note !== undefined && /\n/.test(note)) {
    throw new Error('todo_done: note must be a single line');
  }
  const open = todoList('open', override);
  const target = open.find((r) => r.id === id);
  if (!target) {
    return undefined;
  }
  // Rewrite TODO.md without the matching row.
  const remaining = open.filter((r) => r.id !== id);
  writeOpenList(remaining, override);
  // Append to DONE-TASKS.md.
  const doneAt = new Date().toISOString();
  const noteSuffix = note ? ` — note: ${note}` : '';
  const line = `- [${target.id}] ${target.createdAt} [${target.source}] ${target.text} — done@${doneAt}${noteSuffix}\n`;
  const dPath = donePath(override);
  mkdirSync(dirname(dPath), { recursive: true });
  appendFileSync(dPath, line, 'utf8');
  return { ...target, doneAt, ...(note !== undefined ? { note } : {}) };
}

/** Filter values accepted by `todoList`. */
export type TodoListFilter = 'open' | 'done';

/**
 * List TODOs. `filter='open'` reads `TODO.md`; `filter='done'` reads `DONE-TASKS.md`.
 *
 * @param filter - Which list to read.
 * @param override - Workspace dir override (tests).
 */
export function todoList(filter: TodoListFilter, override?: string): TodoRow[] {
  if (filter === 'open') {
    const path = todoPath(override);
    if (!existsSync(path)) {
      return [];
    }
    return readFileSync(path, 'utf8')
      .split('\n')
      .map(parseLine)
      .filter((r): r is TodoRow => r !== null);
  }
  const dpath = donePath(override);
  if (!existsSync(dpath)) {
    return [];
  }
  return readFileSync(dpath, 'utf8')
    .split('\n')
    .map(parseDoneLine)
    .filter((r): r is DoneRow => r !== null);
}

function parseLine(line: string): TodoRow | null {
  const m = LINE_RE.exec(line.trim());
  if (!m) {
    return null;
  }
  if (!(TODO_SOURCES as readonly string[]).includes(m[3]!)) {
    return null;
  }
  return {
    id: m[1]!,
    createdAt: m[2]!,
    source: m[3] as TodoSource,
    text: m[4]!,
  };
}

function parseDoneLine(line: string): DoneRow | null {
  const m = DONE_LINE_RE.exec(line.trim());
  if (!m) {
    return null;
  }
  if (!(TODO_SOURCES as readonly string[]).includes(m[3]!)) {
    return null;
  }
  return {
    id: m[1]!,
    createdAt: m[2]!,
    source: m[3] as TodoSource,
    text: m[4]!,
    doneAt: m[5]!,
    ...(m[6] !== undefined ? { note: m[6]! } : {}),
  };
}

function writeOpenList(rows: readonly TodoRow[], override?: string): void {
  const path = todoPath(override);
  const text = rows.map((r) => `- [${r.id}] ${r.createdAt} [${r.source}] ${r.text}`).join('\n');
  writeFileSync(path, text === '' ? '' : text + '\n', 'utf8');
}
