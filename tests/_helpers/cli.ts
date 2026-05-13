/**
 * Test helper — shared subprocess invocation of the built `mvpclaw` CLI.
 *
 * Every integration and e2e test was duplicating the same `spawnSync('node',
 * [CLI, ...args], {cwd: REPO_ROOT, env: {...process.env}, timeout, encoding})`
 * boilerplate. This SSOT helper collapses that to `runCli(args, opts?)` and
 * returns a typed `{status, stdout, stderr}` shape.
 *
 * Co-locate with `_helpers/` (the underscore prefix keeps it out of vitest's
 * discovery glob — tests don't run on it).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Absolute path to the compiled CLI entry. */
export const CLI = resolve(__dirname, '..', '..', 'dist', 'cli', 'main.js');
/** Absolute path to the repo root (default cwd for CLI invocations). */
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** Result of one CLI invocation. */
export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Options for `runCli`. */
export interface CliOpts {
  /** Working directory; defaults to REPO_ROOT. */
  cwd?: string;
  /** Path to a config file appended as `--config <path>` after `args`. */
  config?: string;
  /** Env overrides merged onto `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Subprocess timeout in milliseconds (default 30_000). */
  timeoutMs?: number;
}

/**
 * Run the built CLI as a subprocess with the given args.
 *
 * @param args - Arguments after `mvpclaw`, e.g. `['tool', 'list', '--json']`.
 * @param opts - Optional overrides for cwd / config / env / timeout.
 * @returns Typed result with exit status, stdout, and stderr.
 *
 * @example
 * ```ts
 * const r = runCli(['tool', 'list', '--json'], { config: configPath });
 * expect(r.status).toBe(0);
 * expect(JSON.parse(r.stdout)).toHaveLength(20);
 * ```
 */
export function runCli(args: readonly string[], opts: CliOpts = {}): CliResult {
  const fullArgs: string[] = [CLI, ...args];
  if (typeof opts.config === 'string' && opts.config.length > 0) {
    fullArgs.push('--config', opts.config);
  }
  const r = spawnSync('node', fullArgs, {
    encoding: 'utf8',
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: opts.timeoutMs ?? 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
