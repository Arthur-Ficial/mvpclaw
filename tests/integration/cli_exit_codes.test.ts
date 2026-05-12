import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(__dirname, '../../dist/cli/main.js');

/**
 * Canonical exit-code contract from `CLAUDE.md`:
 *   0 success · 1 usage · 2 config · 3 runtime · 4 not found · 5 timeout
 */
describe('CLI exit-code contract', () => {
  it('`mvpclaw doctor --json` outputs parseable JSON (exit 0 or 3)', () => {
    // doctor exits 0 when all checks pass, 3 when any fails. Either way,
    // stdout is structured JSON.
    const result = spawnSync('node', [CLI, 'doctor', '--json'], { encoding: 'utf8' });
    expect([0, 3]).toContain(result.status);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('`--config <missing-path>` is surfaced as a failed check (exit 3)', () => {
    // `doctor` catches loadConfig errors and reports them as a failed
    // `config` check rather than dying with exit 2 — the whole point of
    // doctor is to surface broken state, not crash on it. Other commands
    // (send, agent, status, etc.) DO exit 2 on a missing config — see
    // the `mvpclaw send` e2e test in tests/e2e/mvpclaw_send.test.ts.
    const result = spawnSync(
      'node',
      [CLI, 'doctor', '--config', '/tmp/definitely-not-a-real-config-path-12345.json'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('config');
  });

  it('not-yet-implemented stub exits 3 (runtime)', () => {
    // `tool` is still a stub at this commit (lands in C7 / #31).
    const result = spawnSync('node', [CLI, 'tool', 'list'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('not yet implemented');
  });

  it('unknown sub-command falls through to top-level help (citty)', () => {
    // Citty's default: unknown sub-command → show top-level help, exit 0.
    // The help text is enough for an AI to see what is available.
    const result = spawnSync('node', [CLI, 'bogus'], { encoding: 'utf8' });
    expect((result.stdout + result.stderr).toLowerCase()).toContain('mvpclaw');
  });
});
