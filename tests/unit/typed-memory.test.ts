/**
 * Typed memory unit tests — pin the on-disk format, the validation rules,
 * and round-trip behavior. All tests work in a tmp dir override so they
 * never touch the real `~/.mvpclaw/workspaces/default/memory/` directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  memoryComposerBlock,
  memoryDelete,
  memoryGet,
  memoryList,
  memoryOrphans,
  memorySave,
  validateMemoryInput,
} from '../../src/memory/typed-memory.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-typed-mem-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('typed-memory validation', () => {
  const goodBody = '**Why:** repro\n**How to apply:** when X';

  it('rejects a slug that does not match [a-z0-9_-]+', () => {
    expect(() =>
      validateMemoryInput({
        slug: 'Bad Slug!',
        description: 'd',
        type: 'feedback',
        body: goodBody,
      }),
    ).toThrow(/bad slug/);
  });

  it('rejects unknown types', () => {
    expect(() =>
      validateMemoryInput({
        slug: 'x',
        description: 'd',
        type: 'random' as never,
        body: goodBody,
      }),
    ).toThrow(/unknown type/);
  });

  it('requires Why and How-to-apply for type=feedback', () => {
    expect(() =>
      validateMemoryInput({ slug: 'x', description: 'd', type: 'feedback', body: 'no markers' }),
    ).toThrow(/Why/);
  });

  it('requires Why and How-to-apply for type=project', () => {
    expect(() =>
      validateMemoryInput({ slug: 'x', description: 'd', type: 'project', body: 'no markers' }),
    ).toThrow(/Why/);
  });

  it('allows reference and user types without Why/How', () => {
    expect(() =>
      validateMemoryInput({ slug: 'x', description: 'd', type: 'reference', body: 'plain' }),
    ).not.toThrow();
    expect(() =>
      validateMemoryInput({ slug: 'x', description: 'd', type: 'user', body: 'plain' }),
    ).not.toThrow();
  });
});

describe('typed-memory round-trip', () => {
  it('save → get returns the same record + writes well-formed frontmatter', () => {
    const r = memorySave(
      {
        slug: 'self-restart-suicide',
        description: 'Never restart yourself via unload+load',
        type: 'feedback',
        body: '**Why:** unload kills the bash_exec.\n**How to apply:** use kickstart -k.',
      },
      tmp,
    );
    expect(r.name).toBe('self-restart-suicide');
    expect(r.metadata.type).toBe('feedback');
    const got = memoryGet('self-restart-suicide', tmp);
    expect(got?.body).toContain('**Why:**');
    expect(got?.body).toContain('kickstart');
    const onDisk = readFileSync(join(tmp, 'self-restart-suicide.md'), 'utf8');
    expect(onDisk).toMatch(/^---\n/);
    expect(onDisk).toMatch(/^name: self-restart-suicide$/m);
    expect(onDisk).toMatch(/^ {2}type: feedback$/m);
  });

  it('save → list returns one entry; index is human-readable', () => {
    memorySave(
      {
        slug: 'env-quota',
        description: 'project .env must win over shell',
        type: 'feedback',
        body: '**Why:** old key. **How to apply:** load env first.',
      },
      tmp,
    );
    const list = memoryList(tmp);
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('env-quota');
    expect(list[0]?.type).toBe('feedback');
    const indexBody = readFileSync(join(tmp, 'MEMORY.md'), 'utf8');
    expect(indexBody).toContain('- [project .env must win over shell](env-quota.md) — feedback');
  });

  it('save twice with the same slug replaces (no duplicates in index)', () => {
    memorySave(
      {
        slug: 'rule-x',
        description: 'first',
        type: 'reference',
        body: 'first body',
      },
      tmp,
    );
    memorySave(
      {
        slug: 'rule-x',
        description: 'second',
        type: 'reference',
        body: 'second body',
      },
      tmp,
    );
    const list = memoryList(tmp);
    expect(list).toHaveLength(1);
    expect(list[0]?.description).toBe('second');
  });

  it('delete removes the file and the index entry', () => {
    memorySave({ slug: 'gone', description: 'gone', type: 'reference', body: 'b' }, tmp);
    expect(memoryList(tmp)).toHaveLength(1);
    expect(memoryDelete('gone', tmp)).toBe(true);
    expect(memoryList(tmp)).toHaveLength(0);
    expect(memoryGet('gone', tmp)).toBeUndefined();
  });

  it('delete on missing slug is a no-op returning false', () => {
    expect(memoryDelete('does-not-exist', tmp)).toBe(false);
  });
});

describe('typed-memory composer block', () => {
  it('returns empty string when no MEMORY.md exists', () => {
    expect(memoryComposerBlock(8000, tmp)).toBe('');
  });

  it('inlines index + linked bodies and stops at maxChars', () => {
    memorySave({ slug: 'a', description: 'aaa', type: 'reference', body: 'BODY-A' }, tmp);
    memorySave({ slug: 'b', description: 'bbb', type: 'reference', body: 'BODY-B' }, tmp);
    const block = memoryComposerBlock(8000, tmp);
    expect(block).toContain('### Index (MEMORY.md)');
    expect(block).toContain('BODY-A');
    expect(block).toContain('BODY-B');
    // Tight cap stops after index.
    const tight = memoryComposerBlock(40, tmp);
    expect(tight).toContain('### Index');
    expect(tight).not.toContain('BODY-B');
  });
});

describe('typed-memory orphan detection', () => {
  it('reports files on disk missing from the index', () => {
    memorySave({ slug: 'kept', description: 'kept', type: 'reference', body: 'b' }, tmp);
    // Simulate manual write that bypasses the index.
    const ghostPath = join(tmp, 'ghost.md');
    rmSync(join(tmp, 'kept.md')); // ensure dir exists; manual write below
    memorySave({ slug: 'kept', description: 'kept', type: 'reference', body: 'b' }, tmp);
    // Write a ghost file directly (no index update).
    readFileSync(join(tmp, 'kept.md'), 'utf8'); // sanity
    writeFileSync(ghostPath, '---\nname: ghost\n---\n', 'utf8');
    expect(memoryOrphans(tmp)).toContain('ghost.md');
  });
});
