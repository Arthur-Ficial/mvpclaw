import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `mvpclaw chat` + `mvpclaw agent` sub-command e2e tests (ticket C6).
 *
 * Drives real OpenRouter where it makes sense; the `agent dry-run` test
 * doesn't hit the network at all. Gated by OPENROUTER_API_KEY.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../..');
const key = process.env['OPENROUTER_API_KEY'];
const skip = !key || key.length < 20;

describe.skipIf(skip)('mvpclaw chat + agent — end-to-end through compiled binary', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-chat-agent-e2e-'));
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

  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', [CLI, ...args, '--config', configPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: 75_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('chat new → chat show → chat reset --yes flows', () => {
    const created = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'c6-test-chat',
      '--json',
    ]);
    expect(created.status, created.stderr).toBe(0);
    const newResult = JSON.parse(created.stdout) as {
      chat: { id: string };
      session: { id: string };
    };
    const chatId = newResult.chat.id;

    const shown = runCli(['chat', 'show', chatId, '--json']);
    expect(shown.status).toBe(0);
    const detail = JSON.parse(shown.stdout) as {
      chat: { id: string };
      activeSession: { id: string };
      messages: unknown[];
    };
    expect(detail.chat.id).toBe(chatId);
    expect(detail.activeSession.id).toBe(newResult.session.id);

    // reset without --yes should fail
    const noYes = runCli(['chat', 'reset', chatId, '--json']);
    expect(noYes.status).toBe(1);
    expect(noYes.stderr).toContain('--yes to confirm');

    // reset with --yes creates a new session
    const reset = runCli(['chat', 'reset', chatId, '--yes', '--json']);
    expect(reset.status).toBe(0);
    const r = JSON.parse(reset.stdout) as { newSessionId: string; closedSessions: number };
    expect(r.closedSessions).toBe(1);
    expect(r.newSessionId).not.toBe(newResult.session.id);
  });

  it('chat list returns the chats we created', () => {
    const list = runCli(['chat', 'list', '--json', '--limit', '50']);
    expect(list.status).toBe(0);
    const rows = JSON.parse(list.stdout) as Array<{ providerChatId: string }>;
    const ids = rows.map((r) => r.providerChatId);
    expect(ids).toContain('c6-test-chat');
  });

  it('agent dry-run composes the prompt without calling the provider', () => {
    const created = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'c6-dryrun',
      '--json',
    ]);
    const chatId = (JSON.parse(created.stdout) as { chat: { id: string } }).chat.id;
    const dry = runCli([
      'agent',
      'dry-run',
      '--chat-id',
      chatId,
      '--prompt',
      'What is 2 plus 2?',
      '--json',
    ]);
    expect(dry.status, dry.stderr).toBe(0);
    const parsed = JSON.parse(dry.stdout) as {
      chatId: string;
      systemPrompt: string;
      userText: string;
      provider: string;
    };
    expect(parsed.chatId).toBe(chatId);
    expect(parsed.userText).toBe('What is 2 plus 2?');
    expect(parsed.systemPrompt.length).toBeGreaterThan(0);
    expect(parsed.provider).toBe('openrouter');
  });

  it('agent run produces a real reply against OpenRouter', () => {
    const created = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'c6-run',
      '--json',
    ]);
    const chatId = (JSON.parse(created.stdout) as { chat: { id: string } }).chat.id;
    const r = runCli([
      'agent',
      'run',
      '--chat-id',
      chatId,
      '--prompt',
      'Reply with just the word OK and nothing else.',
      '--json',
    ]);
    const isBillingCapped = r.status === 3 && /Key limit exceeded|40[39]/.test(r.stderr + r.stdout);
    if (isBillingCapped) {
      const result = JSON.parse(r.stdout) as { status: string; error?: string };
      expect(result.status).toBe('failed');
      expect(result.error ?? '').toMatch(/Key limit|40[39]/);
      return;
    }
    expect(r.status, r.stderr).toBe(0);
    const result = JSON.parse(r.stdout) as { status: string; replyText: string; runId: string };
    expect(result.status).toBe('succeeded');
    expect(result.replyText.length).toBeGreaterThan(0);
    expect(result.runId).toBeTruthy();
  }, 90_000);
});
