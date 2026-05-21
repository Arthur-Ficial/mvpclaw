/**
 * Typed persistent memory — Claude-Code-style MEMORY.md index plus
 * individual `<slug>.md` files with YAML frontmatter.
 *
 * Lives at `~/.mvpclaw/workspaces/default/memory/`.
 *
 * Four memory types mirror Claude Code (`feedback`, `project`, `reference`,
 * `user`). Bodies for `feedback` and `project` must contain a `**Why:**`
 * line and a `**How to apply:**` line — that's how future selves can judge
 * edge cases instead of blindly following a rule. Validation lives in
 * `validateMemoryInput`; the tools that wrap these functions surface
 * validation errors to the agent verbatim.
 *
 * No SQLite involvement on purpose. Memory is plain markdown on disk so
 * Owner can `cat` and `git diff` it without any tooling.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Allowed `metadata.type` values. Matches Claude Code's auto-memory schema. */
export const MEMORY_TYPES = ['feedback', 'project', 'reference', 'user'] as const;
/** Type union derived from `MEMORY_TYPES`. */
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Frontmatter shape persisted to each memory file. */
export interface MemoryFrontmatter {
  /** Slug. Must match `[a-z0-9_-]+`. Mirrors filename without `.md`. */
  name: string;
  /** One-line summary — shown verbatim in MEMORY.md and used for relevance scans. */
  description: string;
  /** Structured metadata. */
  metadata: { type: MemoryType; createdAt: string };
}

/** A parsed memory file (frontmatter + body). */
export interface MemoryRecord extends MemoryFrontmatter {
  /** Body of the file (the markdown after the closing `---`). */
  body: string;
}

/** Input passed to `memorySave`. */
export interface MemorySaveInput {
  slug: string;
  description: string;
  type: MemoryType;
  body: string;
}

/** One row in MEMORY.md, parsed back from the index. */
export interface MemoryIndexEntry {
  slug: string;
  description: string;
  type: MemoryType;
}

const SLUG_RE = /^[a-z0-9_-]+$/;
const MAX_DESCRIPTION = 200;
const MAX_BODY = 10_000;
const MAX_MEMORY_MD_LINES = 200;

/**
 * Resolve the memory directory. Defaults to `~/.mvpclaw/workspaces/default/memory/`
 * but tests override via the second arg.
 */
export function memoryDir(override?: string): string {
  return override ?? join(homedir(), '.mvpclaw', 'workspaces', 'default', 'memory');
}

/** Resolve a memory file path for `slug`. */
export function memoryFilePath(slug: string, override?: string): string {
  return join(memoryDir(override), `${slug}.md`);
}

/** Resolve the MEMORY.md index path. */
export function memoryIndexPath(override?: string): string {
  return join(memoryDir(override), 'MEMORY.md');
}

/**
 * Validate `input`. Throws on any rule violation; returns `void` on success.
 *
 * Rules:
 * - slug matches `[a-z0-9_-]+`, length 1..64
 * - description length 1..200
 * - type ∈ MEMORY_TYPES
 * - body length 1..10000
 * - For type=feedback|project: body MUST contain both `**Why:**` and `**How to apply:**`
 *
 * @param input - The save input to validate.
 */
export function validateMemoryInput(input: MemorySaveInput): void {
  if (!SLUG_RE.test(input.slug) || input.slug.length > 64) {
    throw new Error(`memory: bad slug "${input.slug}" — must match [a-z0-9_-]+ and be ≤64 chars`);
  }
  if (input.description.length === 0 || input.description.length > MAX_DESCRIPTION) {
    throw new Error(`memory: description must be 1..${MAX_DESCRIPTION} chars`);
  }
  if (!(MEMORY_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`memory: unknown type "${input.type}" — allowed: ${MEMORY_TYPES.join(', ')}`);
  }
  if (input.body.length === 0 || input.body.length > MAX_BODY) {
    throw new Error(`memory: body must be 1..${MAX_BODY} chars`);
  }
  if (input.type === 'feedback' || input.type === 'project') {
    if (!/\*\*Why:\*\*/.test(input.body)) {
      throw new Error(`memory: type=${input.type} requires a \`**Why:**\` line in body`);
    }
    if (!/\*\*How to apply:\*\*/.test(input.body)) {
      throw new Error(`memory: type=${input.type} requires a \`**How to apply:**\` line in body`);
    }
  }
}

/** Serialize a frontmatter + body to the on-disk format. */
function renderMemoryFile(fm: MemoryFrontmatter, body: string): string {
  return [
    '---',
    `name: ${fm.name}`,
    `description: ${fm.description}`,
    'metadata:',
    `  type: ${fm.metadata.type}`,
    `  createdAt: ${fm.metadata.createdAt}`,
    '---',
    '',
    body.endsWith('\n') ? body : body + '\n',
  ].join('\n');
}

/** Parse a memory file body into `{frontmatter, body}` or throw. */
export function parseMemoryFile(text: string): MemoryRecord {
  if (!text.startsWith('---\n')) {
    throw new Error('memory: file missing YAML frontmatter');
  }
  const end = text.indexOf('\n---', 4);
  if (end < 0) {
    throw new Error('memory: file missing closing `---`');
  }
  const fmText = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const name = /^name:\s*(.+)$/m.exec(fmText)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(fmText)?.[1]?.trim();
  const type = /^\s*type:\s*(\w+)\s*$/m.exec(fmText)?.[1]?.trim() as MemoryType | undefined;
  const createdAt = /^\s*createdAt:\s*(.+)$/m.exec(fmText)?.[1]?.trim();
  if (!name || !description || !type || !createdAt) {
    throw new Error('memory: frontmatter missing one of name/description/type/createdAt');
  }
  if (!(MEMORY_TYPES as readonly string[]).includes(type)) {
    throw new Error(`memory: invalid type "${type}" in frontmatter`);
  }
  return { name, description, metadata: { type, createdAt }, body };
}

/**
 * Save a typed memory. Creates the memory dir if missing, writes
 * `<slug>.md`, and upserts the MEMORY.md index entry.
 *
 * @param input - slug/description/type/body.
 * @param override - Override the default memory dir (tests only).
 * @returns The persisted record.
 */
export function memorySave(input: MemorySaveInput, override?: string): MemoryRecord {
  validateMemoryInput(input);
  const dir = memoryDir(override);
  mkdirSync(dir, { recursive: true });
  const fm: MemoryFrontmatter = {
    name: input.slug,
    description: input.description,
    metadata: { type: input.type, createdAt: new Date().toISOString() },
  };
  writeFileSync(memoryFilePath(input.slug, override), renderMemoryFile(fm, input.body), 'utf8');
  upsertIndexEntry(
    { slug: input.slug, description: input.description, type: input.type },
    override,
  );
  return { ...fm, body: input.body };
}

/**
 * Read one memory by slug. Returns `undefined` if no such file exists.
 *
 * @param slug - The slug to read.
 * @param override - Memory dir override (tests).
 */
export function memoryGet(slug: string, override?: string): MemoryRecord | undefined {
  const path = memoryFilePath(slug, override);
  if (!existsSync(path)) {
    return undefined;
  }
  return parseMemoryFile(readFileSync(path, 'utf8'));
}

/**
 * Delete one memory by slug. Removes the file and the index entry. Idempotent.
 *
 * @param slug - The slug to delete.
 * @param override - Memory dir override (tests).
 * @returns `true` if a file was removed, `false` if it didn't exist.
 */
export function memoryDelete(slug: string, override?: string): boolean {
  const path = memoryFilePath(slug, override);
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path);
  removeIndexEntry(slug, override);
  return true;
}

/**
 * Parse MEMORY.md and return the index entries. Files on disk that are
 * missing from the index are NOT included — the index is the source of
 * truth (matches Claude Code's behavior).
 *
 * @param override - Memory dir override (tests).
 */
export function memoryList(override?: string): MemoryIndexEntry[] {
  const path = memoryIndexPath(override);
  if (!existsSync(path)) {
    return [];
  }
  const body = readFileSync(path, 'utf8');
  return parseIndex(body);
}

/**
 * Read the raw text of MEMORY.md plus the bodies of every linked file,
 * capped at `maxChars` total. Used by the composer to inline persistent
 * memory at the top of every prompt.
 *
 * @param maxChars - Soft cap; once exceeded, no more file bodies are appended.
 * @param override - Memory dir override (tests).
 */
export function memoryComposerBlock(maxChars = 8000, override?: string): string {
  const indexPath = memoryIndexPath(override);
  if (!existsSync(indexPath)) {
    return '';
  }
  const index = readFileSync(indexPath, 'utf8').trim();
  if (index.length === 0) {
    return '';
  }
  const parts: string[] = [`### Index (MEMORY.md)\n${index}`];
  let total = parts[0]!.length;
  for (const entry of parseIndex(index)) {
    const filePath = memoryFilePath(entry.slug, override);
    if (!existsSync(filePath)) {
      continue;
    }
    const fileBody = readFileSync(filePath, 'utf8');
    if (total + fileBody.length > maxChars) {
      break;
    }
    parts.push(`### ${entry.slug}\n${fileBody}`);
    total += fileBody.length;
  }
  return parts.join('\n\n').trim();
}

/** Walk the memory dir and confirm every file has a matching index entry. */
export function memoryOrphans(override?: string): string[] {
  const dir = memoryDir(override);
  if (!existsSync(dir)) {
    return [];
  }
  const indexed = new Set(memoryList(override).map((e) => e.slug));
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  return files.filter((f) => !indexed.has(f.replace(/\.md$/, '')));
}

// ── internal: MEMORY.md index handling ──────────────────────────────────

const INDEX_LINE_RE = /^- \[(.+?)\]\((.+?)\.md\) — (\w+)$/;

function parseIndex(body: string): MemoryIndexEntry[] {
  const out: MemoryIndexEntry[] = [];
  for (const line of body.split('\n')) {
    const m = INDEX_LINE_RE.exec(line.trim());
    if (!m) {
      continue;
    }
    const type = m[3] as MemoryType;
    if (!(MEMORY_TYPES as readonly string[]).includes(type)) {
      continue;
    }
    out.push({ description: m[1]!, slug: m[2]!, type });
  }
  return out;
}

function upsertIndexEntry(entry: MemoryIndexEntry, override?: string): void {
  const path = memoryIndexPath(override);
  mkdirSync(memoryDir(override), { recursive: true });
  const lines = existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.length > 0)
    : [];
  const filtered = lines.filter((l) => {
    const m = INDEX_LINE_RE.exec(l.trim());
    return !(m && m[2] === entry.slug);
  });
  filtered.push(`- [${entry.description}](${entry.slug}.md) — ${entry.type}`);
  if (filtered.length > MAX_MEMORY_MD_LINES) {
    throw new Error(
      `memory: MEMORY.md would exceed ${MAX_MEMORY_MD_LINES} lines — prune before saving more`,
    );
  }
  writeFileSync(path, filtered.join('\n') + '\n', 'utf8');
}

function removeIndexEntry(slug: string, override?: string): void {
  const path = memoryIndexPath(override);
  if (!existsSync(path)) {
    return;
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  const filtered = lines.filter((l) => {
    const m = INDEX_LINE_RE.exec(l.trim());
    return !(m && m[2] === slug);
  });
  writeFileSync(path, filtered.join('\n'), 'utf8');
}
