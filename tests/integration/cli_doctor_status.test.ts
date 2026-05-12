import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * P10 — doctor + status integration tests.
 *
 * Both commands run against a freshly-built config in a tmp dir. The
 * `doctor` check that requires `claude --version` is exercised through
 * the REAL binary (no fake) — and only when the configured provider is
 * `claude-cli`. Default config here uses `openrouter`, so the
 * `claude-cli` check is skipped unless we explicitly opt in.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../..');

describe('mvpclaw doctor + status — health/introspection', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-doctor-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    configPath = join(tmp, 'mvpclaw.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        app: { dataDir: join(tmp, 'data'), workspaceDir: join(tmp, 'workspace') },
        database: { url: `file:${join(tmp, 'data', 'mvpclaw.sqlite')}` },
        agent: { provider: 'openrouter' },
        openrouter: { enabled: true },
        telegram: { enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN_UNSET' },
      }),
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', [CLI, ...args, '--config', configPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: 30_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('doctor exits 0 with valid config + key set', () => {
    const r = runCli(['doctor', '--json']);
    // Status depends on whether OPENROUTER_API_KEY is set in the test env.
    if (process.env['OPENROUTER_API_KEY'] && process.env['OPENROUTER_API_KEY'].length >= 20) {
      expect(r.status, r.stderr).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        checks: Array<{ name: string; ok: boolean }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.checks.find((c) => c.name === 'node')?.ok).toBe(true);
      expect(parsed.checks.find((c) => c.name === 'config')?.ok).toBe(true);
      expect(parsed.checks.find((c) => c.name === 'sqlite')?.ok).toBe(true);
      expect(parsed.checks.find((c) => c.name === 'openrouter')?.ok).toBe(true);
    } else {
      // Without the key, doctor should fail the openrouter check.
      expect(r.status).toBe(3);
      expect(r.stderr).toContain('openrouter');
    }
  });

  it('doctor fails clearly when config path is invalid', () => {
    const r = spawnSync('node', [CLI, 'doctor', '--config', '/tmp/no-such-config-12345.json'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    // Either exit 2 (config) at load time, or exit 3 with the config check failed.
    expect([2, 3]).toContain(r.status);
  });

  it('status prints provider + counts + key presence (never key value)', () => {
    const r = runCli(['status', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      provider: string;
      counts: Record<string, number>;
      telegramConfigured: string;
      openrouterConfigured: string;
    };
    expect(parsed.provider).toBe('openrouter');
    expect(parsed.counts).toHaveProperty('chats');
    expect(parsed.counts).toHaveProperty('outbox_pending');
    // Key-presence values are "Yes" / "No" — never the raw value.
    expect(['Yes', 'No']).toContain(parsed.telegramConfigured);
    expect(['Yes', 'No']).toContain(parsed.openrouterConfigured);
    // And the raw key, if present in env, must NOT be in the output.
    const key = process.env['OPENROUTER_API_KEY'];
    if (typeof key === 'string' && key.length > 0) {
      expect(r.stdout).not.toContain(key);
    }
  });
});
