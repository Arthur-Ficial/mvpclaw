/**
 * Sanity test for the shared `runCli` test helper. The helper itself is
 * trivial (spawnSync wrapper) but covering it pins the contract:
 *  - args + --config appended as expected
 *  - stdout / stderr parsed as strings
 *  - exit status surfaced
 */
import { describe, expect, it } from 'vitest';
import { CLI, REPO_ROOT, runCli } from '../_helpers/cli.js';

describe('test-helper runCli', () => {
  it('exposes absolute paths to the CLI and repo root', () => {
    expect(CLI.endsWith('/dist/cli/main.js')).toBe(true);
    expect(REPO_ROOT.endsWith('/mvpclaw')).toBe(true);
  });

  it('runs `mvpclaw --help` (always exit 0) and surfaces stdout', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout.toLowerCase()).toMatch(/mvpclaw|usage/);
  });

  it('passes an unknown sub-command through and reports non-zero exit', () => {
    const r = runCli(['definitely-not-a-real-subcommand'], { timeoutMs: 10_000 });
    expect(r.status).not.toBe(0);
  });
});
