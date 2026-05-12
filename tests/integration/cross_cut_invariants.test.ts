import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * C12 — cross-cut invariants test.
 *
 * The CLI-first architectural pivot (commits 342166c onward) added a set
 * of project-wide invariants that need to survive future edits:
 *
 *   - CLAUDE.md establishes CLI-first as non-negotiable.
 *   - ARCHITECTURE.md §1bis documents the ChannelAdapter abstraction.
 *   - Neither doc accidentally re-introduces a docs portal as part of
 *     the build (TypeDoc / Starlight / MkDocs are explicit non-goals).
 *   - The repo layout no longer references `src/telegram/` as a live
 *     folder (it's `src/channels/telegram.channel.ts` now).
 *
 * If a future edit drifts away from any of these, this test fails.
 */

const REPO = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(REPO, rel), 'utf8');
}

describe('cross-cut invariants — CLAUDE.md + ARCHITECTURE.md', () => {
  it('CLAUDE.md establishes the CLI-first principle + golden goal', () => {
    const body = read('CLAUDE.md');
    for (const required of [
      'CLI-first / AI-steerable',
      'Source code IS the documentation',
      'A template for a zero-install, Claude-Code-installable',
      'channel adapter',
    ]) {
      expect(body, `CLAUDE.md missing: ${required}`).toContain(required);
    }
    // --json must appear (universal flag); use a substring search the
    // grep-flag bug can't hit.
    expect(body.includes('--json')).toBe(true);
  });

  it('ARCHITECTURE.md documents §1bis + ChannelAdapter + the new layout', () => {
    const body = read('ARCHITECTURE.md');
    for (const required of ['1bis', 'ChannelAdapter', 'src/channels/', 'src/cli/cmd/']) {
      expect(body, `ARCHITECTURE.md missing: ${required}`).toContain(required);
    }
  });

  it('neither doc treats TypeDoc / Starlight / MkDocs as a build dep', () => {
    // These can be MENTIONED (e.g. in a "no docs portal" non-goal list) but
    // must not appear in code-quality / build / lint instructions. Quick
    // proxy: TypeDoc / Starlight / MkDocs do not appear in package.json
    // and any mention in the docs sits next to a "no" / "not" / "without".
    const claude = read('CLAUDE.md');
    const arch = read('ARCHITECTURE.md');
    const pkg = read('package.json');

    expect(pkg).not.toContain('typedoc');
    expect(pkg).not.toContain('starlight');
    expect(pkg).not.toContain('mkdocs');

    for (const doc of [claude, arch]) {
      for (const m of doc.matchAll(/TypeDoc|Starlight|MkDocs/gi)) {
        const start = Math.max(0, m.index - 30);
        const end = Math.min(doc.length, m.index + m[0].length + 30);
        const window = doc.slice(start, end).toLowerCase();
        expect(
          /\bno\b|not\b|without|out\b|skip|non-goal/.test(window),
          `${m[0]} mentioned without a negation: "${doc.slice(start, end)}"`,
        ).toBe(true);
      }
    }
  });

  it('docs do not reference src/telegram/ as a live folder path', () => {
    for (const file of ['CLAUDE.md', 'ARCHITECTURE.md', 'README.md']) {
      const body = read(file);
      expect(
        body.includes('src/telegram/'),
        `${file} still references src/telegram/ as a live path — it should be src/channels/telegram.channel.ts`,
      ).toBe(false);
    }
  });

  it('package.json scripts exist + include `check`', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of [
      'dev',
      'build',
      'typecheck',
      'lint',
      'format',
      'format:check',
      'test',
      'test:e2e',
      'migrate',
      'check',
    ]) {
      expect(pkg.scripts, `missing script: ${script}`).toHaveProperty(script);
    }
    // `check` runs build BEFORE tests (so tests against dist/ see fresh binary).
    expect(pkg.scripts['check']).toContain('build');
    expect(pkg.scripts['check']).toMatch(/build.*test/);
  });

  it('.gitignore excludes secrets and runtime artifacts', () => {
    const gi = read('.gitignore');
    for (const required of ['.env', 'data/', 'workspace/', 'node_modules', 'dist/']) {
      expect(gi, `.gitignore missing: ${required}`).toContain(required);
    }
    // .mvpclaw-install.json should NOT be gitignored (it's committed
    // intentionally so future agents know the install is done).
    expect(gi).not.toMatch(/^\.mvpclaw-install\.json/m);
  });
});
