import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(__dirname, '../../dist/cli/main.js');

/**
 * Canonical exit-code contract from `CLAUDE.md`:
 *   0 success · 1 usage · 2 config · 3 runtime · 4 not found · 5 timeout
 */
describe('CLI exit-code contract', () => {
  it('successful `mvpclaw doctor` exits 0', () => {
    const result = spawnSync('node', [CLI, 'doctor', '--json'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    // stdout is JSON.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('`--config <missing-path>` exits 2 (config error)', () => {
    const result = spawnSync(
      'node',
      [CLI, 'doctor', '--config', '/tmp/definitely-not-a-real-config-path-12345.json'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mvpclaw: config:');
  });

  it('not-yet-implemented stub exits 3 (runtime)', () => {
    const result = spawnSync('node', [CLI, 'send', '--chat-id', '1', '--text', 'x'], {
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
