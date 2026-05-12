import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `mvpclaw outbox` sub-commands exercised through the compiled binary.
 *
 * Drives `mvpclaw send` first (real OpenRouter, openai/gpt-4o-mini) to
 * produce real outbox rows, then asserts `outbox list`, `outbox peek`,
 * and `outbox flush --dry-run` behave correctly.
 *
 * Gated by `OPENROUTER_API_KEY` — skipped without it.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../..');
const key = process.env['OPENROUTER_API_KEY'];
const skip = !key || key.length < 20;

describe.skipIf(skip)('mvpclaw outbox — end-to-end through compiled binary', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-outbox-e2e-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
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

  function runCli(
    args: string[],
    opts: { input?: string } = {},
  ): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const result = spawnSync('node', [CLI, ...args, '--config', configPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: 75_000,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('list shows the row produced by a `send` round-trip', () => {
    // First send a message — real OpenRouter, real outbox row.
    const send = runCli([
      'send',
      '--channel',
      'cli-inject',
      '--chat-id',
      'chat-outbox-test',
      '--text',
      'Reply just OK.',
      '--wait',
      '60',
      '--json',
    ]);
    const isBillingCapped =
      send.status === 3 && /Key limit exceeded|40[39]/.test(send.stderr + send.stdout);
    if (isBillingCapped) {
      // Upstream key is capped — request shape made it to OpenRouter but
      // the model didn't run. Skip the rest of this scenario.
      return;
    }
    expect(send.status, `send stderr: ${send.stderr}`).toBe(0);
    const sendResult = JSON.parse(send.stdout) as { runId: string };
    expect(sendResult.runId).toBeTruthy();

    // Now list — exactly one row, status 'sent' (cli-inject's send was a no-op).
    const list = runCli(['outbox', 'list', '--json', '--limit', '50']);
    expect(list.status, `list stderr: ${list.stderr}`).toBe(0);
    const rows = JSON.parse(list.stdout) as Array<{ id: string; status: string; text: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[0];
    expect(last?.status).toBe('sent');
    expect(last?.text.length).toBeGreaterThan(0);
  }, 120_000);

  it('peek returns 4 (not-found) for a bogus id', () => {
    const peek = runCli(['outbox', 'peek', 'definitely-not-a-real-outbox-id', '--json']);
    expect(peek.status).toBe(4);
    expect(peek.stderr).toContain('not found');
  });

  it('flush --dry-run prints the pending count without sending', () => {
    const flush = runCli(['outbox', 'flush', '--dry-run', '--json']);
    expect(flush.status).toBe(0);
    const parsed = JSON.parse(flush.stdout) as { dryRun: boolean; pendingCount: number };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.pendingCount).toBe(0); // already drained by the send above
  });
});
