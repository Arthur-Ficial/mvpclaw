import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Spawn the compiled CLI binary and assert the help-text contract:
 *
 *   - `mvpclaw --help` mentions every sub-command in the documented surface.
 *   - `mvpclaw <cmd> --help` is non-empty.
 *
 * This is the canonical proof that the CLI surface from `CLAUDE.md` is wired
 * up, not just documented.
 */
const CLI = resolve(__dirname, '../../dist/cli/main.js');

const SUBCOMMANDS = [
  'send',
  'outbox',
  'chat',
  'agent',
  'tool',
  'task',
  'memory',
  'skill',
  'mcp',
  'db',
  'trace',
  'config',
  'doctor',
  'status',
  'replay',
  'start',
];

describe('CLI help surface', () => {
  it('`mvpclaw --help` lists every documented sub-command', () => {
    const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const helpText = (result.stdout + result.stderr).toLowerCase();
    for (const name of SUBCOMMANDS) {
      expect(helpText, `missing sub-command "${name}" in help text`).toContain(name);
    }
  });

  it('`mvpclaw <cmd> --help` is non-empty for every sub-command', () => {
    for (const name of SUBCOMMANDS) {
      const result = spawnSync('node', [CLI, name, '--help'], { encoding: 'utf8' });
      const helpText = result.stdout + result.stderr;
      // citty exits 0 for --help; tolerate non-zero from sub-commands that
      // print their help to stderr instead.
      expect(helpText.trim().length, `${name} --help was empty`).toBeGreaterThan(0);
    }
  });

  it('unknown sub-command shows help (citty behavior)', () => {
    // Citty's default behavior for an unknown sub-command is to fall back to
    // showing the top-level help text (similar to `git unknown`). The exit
    // code is 0 but the user clearly sees the available commands.
    const result = spawnSync('node', [CLI, 'definitely-not-a-real-command'], { encoding: 'utf8' });
    const out = (result.stdout + result.stderr).toLowerCase();
    expect(out).toContain('mvpclaw');
    expect(out).toContain('send');
  });
});
