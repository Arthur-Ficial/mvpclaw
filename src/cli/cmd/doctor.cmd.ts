/**
 * `mvpclaw doctor` — health check.
 *
 * Walks a list of checks, each of which returns `{ name, ok, detail }`.
 * Exit code is 0 when every check passes; non-zero when ANY fails, with
 * a stderr summary line naming the failing checks.
 *
 * Checks today (P10):
 *   - node:        Node version ≥ 24
 *   - config:      loadConfig() succeeded
 *   - sqlite:      open + migrations up to date
 *   - openrouter:  API key env var set when the provider is enabled
 *   - claude-cli:  `claude --version` works when that provider is selected
 *   - telegram:    token env var set when telegram is enabled
 *   - gh/vercel/himalaya: warn-only — optional CLIs the deploy/email skills
 *     need; reported when the matching config feature is enabled. Warnings
 *     never fail doctor.
 *
 * (MCP server reachability lands when P8 wires the MCP client.)
 */
import { defineCommand } from 'citty';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../../config/index.js';
import { applyMigrations, openDb, pathFromUrl } from '../../db/index.js';
import { exitConfig } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

/**
 * Outcome of a single check. `severity: 'warn'` checks are informational —
 * they never fail `doctor` (a missing optional CLI is not a broken install).
 */
interface Check {
  name: string;
  ok: boolean;
  detail: string;
  severity?: 'error' | 'warn';
}

/**
 * Probe whether an executable is on PATH (no shell, so the name can't be
 * interpreted as a command). Returns true when `which <bin>` exits 0.
 */
function onPath(bin: string): boolean {
  const r = spawnSync('/usr/bin/which', [bin], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0;
}

/** Build the full check list for the active config. */
function runChecks(args: Record<string, unknown>): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [];

  // 1. Node version.
  const nodeVer = process.versions.node;
  const major = Number(nodeVer.split('.')[0]);
  checks.push({
    name: 'node',
    ok: Number.isFinite(major) && major >= 24,
    detail: `v${nodeVer}`,
  });

  // 2. Config load.
  let config;
  try {
    config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    checks.push({
      name: 'config',
      ok: true,
      detail: `provider=${config.agent.provider}; data=${config.app.dataDir}`,
    });
  } catch (err) {
    checks.push({
      name: 'config',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    // Without config, downstream checks can't run.
    return { ok: false, checks };
  }

  // 3. SQLite + migrations.
  try {
    const dbPath = pathFromUrl(config.database.url);
    const db = openDb(dbPath);
    const applied = applyMigrations(db, 'migrations');
    const totalMigrations = (
      db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }
    ).c;
    db.close();
    checks.push({
      name: 'sqlite',
      ok: true,
      detail: `${totalMigrations} migrations applied; ${applied.length} new this run`,
    });
  } catch (err) {
    checks.push({
      name: 'sqlite',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Provider key checks (one per ENABLED provider).
  if (config.openrouter.enabled) {
    const key = process.env[config.openrouter.apiKeyEnv];
    checks.push({
      name: 'openrouter',
      ok: typeof key === 'string' && key.length >= 20,
      detail:
        typeof key === 'string' && key.length >= 20
          ? `${config.openrouter.apiKeyEnv} set (${key.length} chars); model=${config.openrouter.defaultModel}`
          : `env var ${config.openrouter.apiKeyEnv} is missing or too short`,
    });
  }
  if (config.agent.provider === 'claude-cli') {
    const claudeCmd = config.claudeCli.command;
    const result = spawnSync(claudeCmd, ['--version'], { encoding: 'utf8', timeout: 5000 });
    checks.push({
      name: 'claude-cli',
      ok: result.status === 0,
      detail:
        result.status === 0
          ? ((result.stdout || result.stderr).trim().split('\n')[0] ?? 'ok')
          : `\`${claudeCmd} --version\` failed: ${(result.stderr || result.error?.message || '').trim()}`,
    });
  }

  // 5. Telegram token (only when telegram is enabled in config).
  if (config.telegram.enabled) {
    const token = process.env[config.telegram.tokenEnv];
    checks.push({
      name: 'telegram',
      ok: typeof token === 'string' && /^\d{8,12}:[A-Za-z0-9_-]{30,}$/.test(token),
      detail:
        typeof token === 'string' && token.length >= 40
          ? `${config.telegram.tokenEnv} set (looks valid)`
          : `${config.telegram.tokenEnv} missing or malformed`,
    });
  }

  // 6. Optional skill CLIs (warn-only — needed by the deploy/email skills).
  //    Each is reported only when its feature is enabled in config, so doctor
  //    reflects what the operator actually turned on.
  if (config.deploys.github.enabled) {
    const ok = onPath('gh');
    checks.push({
      name: 'gh',
      ok,
      severity: 'warn',
      detail: ok
        ? 'on PATH (github-deploy ready)'
        : 'missing — needed for the github-deploy skill (brew install gh)',
    });
  }
  if (config.deploys.vercel.enabled) {
    const ok = onPath('vercel');
    checks.push({
      name: 'vercel',
      ok,
      severity: 'warn',
      detail: ok
        ? 'on PATH (vercel-deploy ready)'
        : 'missing — needed for the vercel-deploy skill (npm i -g vercel)',
    });
  }
  if (config.email.enabled) {
    const ok = onPath('himalaya');
    checks.push({
      name: 'himalaya',
      ok,
      severity: 'warn',
      detail: ok
        ? 'on PATH (email skill ready)'
        : 'missing — needed for the email skill (brew install himalaya)',
    });
  }

  // Warnings never fail doctor; only error-severity checks gate the exit code.
  const ok = checks.filter((c) => c.severity !== 'warn').every((c) => c.ok);
  return { ok, checks };
}

export const doctorCmd = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Run health checks — Node, config, DB, providers, channels.',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let result;
    try {
      result = runChecks(args);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    writeOut(result, ctx);
    if (!result.ok) {
      const failed = result.checks.filter((c) => !c.ok && c.severity !== 'warn').map((c) => c.name);
      process.stderr.write(
        `mvpclaw: doctor: ${failed.length} check(s) failed: ${failed.join(', ')}\n`,
      );
      process.exit(3);
    }
  },
});
