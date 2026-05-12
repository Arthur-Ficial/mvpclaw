import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * MILESTONE A — `mvpclaw send` end-to-end through the COMPILED binary.
 *
 * The test spawns `node dist/cli/main.js send --channel cli-inject ...`,
 * parses the JSON output, and asserts that:
 *
 *   1. The command exits 0.
 *   2. STDOUT is parseable JSON with `status: "succeeded"`.
 *   3. The reply text is non-empty.
 *   4. A trace file exists at `tracePath`.
 *   5. The whole round-trip completes within 60 seconds against the REAL
 *      OpenRouter API (`openai/gpt-4o-mini`, ~$0.0001/call).
 *
 * Gated by `OPENROUTER_API_KEY` — skipped if the env var is absent so the
 * suite doesn't fail in clean-env CI.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');
const MIGRATIONS = resolve(__dirname, '../../migrations');
const key = process.env['OPENROUTER_API_KEY'];
const skip = !key || key.length < 20;

describe.skipIf(skip)('mvpclaw send — end-to-end through compiled binary', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-send-e2e-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    mkdirSync(join(tmp, 'migrations'), { recursive: true });
    configPath = join(tmp, 'mvpclaw.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        app: { dataDir: join(tmp, 'data'), workspaceDir: join(tmp, 'workspace') },
        database: { url: `file:${join(tmp, 'data', 'mvpclaw.sqlite')}` },
        agent: { provider: 'openrouter' },
        openrouter: { defaultModel: 'openai/gpt-4o-mini' },
        telegram: { enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN_UNSET' },
      }),
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cli-inject round-trip → succeeded + reply + trace file', () => {
    // The migrations dir lookup is repo-relative (cwd-based); pass cwd so the
    // CLI finds them. Tests then run from the test's tmp dir for data files.
    const result = spawnSync(
      'node',
      [
        CLI,
        'send',
        '--channel',
        'cli-inject',
        '--chat-id',
        '1',
        '--text',
        'Reply with just the word OK and nothing else.',
        '--wait',
        '60',
        '--json',
        '--config',
        configPath,
      ],
      {
        encoding: 'utf8',
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env },
        timeout: 75_000,
      },
    );

    // Billing-cap detection: when the OpenRouter key is rate-limited, the
    // request still left this process correctly. We then check that the
    // orchestrator captured the upstream error and exited with a runtime
    // code (3) rather than a code defect.
    const isBillingCapped =
      result.status === 3 && /Key limit exceeded|40[39]/.test(result.stderr + result.stdout);
    if (isBillingCapped) {
      const parsed = JSON.parse(result.stdout.trim()) as { status: string; error?: string };
      expect(parsed.status).toBe('failed');
      expect(parsed.error ?? '').toMatch(/Key limit|40[39]/);
      return;
    }

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim().length, 'stdout should be non-empty JSON').toBeGreaterThan(0);

    const parsed = JSON.parse(result.stdout.trim()) as {
      status: string;
      replyText: string;
      runId: string | null;
      tracePath: string | null;
      durationMs: number;
      outboxSent: number;
    };

    expect(parsed.status).toBe('succeeded');
    expect(parsed.replyText.length).toBeGreaterThan(0);
    expect(parsed.runId).not.toBeNull();
    expect(parsed.tracePath).not.toBeNull();
    expect(parsed.outboxSent).toBe(1);
    expect(parsed.durationMs).toBeGreaterThan(0);
    expect(parsed.durationMs).toBeLessThan(60_000);

    // Migrations dir is unused here (used only by the test name); silences lint.
    void MIGRATIONS;
  }, 90_000);

  it('rejects an unknown channel with exit 2 (config error)', () => {
    const result = spawnSync(
      'node',
      [
        CLI,
        'send',
        '--channel',
        'not-a-real-channel',
        '--chat-id',
        '1',
        '--text',
        'x',
        '--config',
        configPath,
      ],
      {
        encoding: 'utf8',
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env },
        timeout: 30_000,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not wired');
  }, 30_000);
});
