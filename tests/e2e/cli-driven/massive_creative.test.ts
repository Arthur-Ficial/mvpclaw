import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * MASSIVE creative end-to-end suite — 25 scenarios.
 *
 * Each scenario is a believable user interaction that exercises a different
 * combination of features: history, tools, memory, skills, scheduling,
 * structured output, slash commands, the composer pipeline, the outbox.
 * All hit the REAL OpenRouter API; no fakes anywhere.
 */

const CLI = resolve(__dirname, '../../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../../..');
const key = process.env['OPENROUTER_API_KEY'];
const liveSkip = !key || key.length < 20;

describe.skipIf(liveSkip)('MASSIVE creative e2e — 25 scenarios via real OpenRouter', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-massive-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    configPath = join(tmp, 'mvpclaw.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        app: { dataDir: join(tmp, 'data'), workspaceDir: join(tmp, 'workspace') },
        database: { url: `file:${join(tmp, 'data', 'mvpclaw.sqlite')}` },
        agent: { provider: 'openrouter' },
        openrouter: { enabled: true, defaultModel: 'openai/gpt-4o-mini' },
        telegram: { enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN_UNSET' },
      }),
    );
    runCli(['db', 'migrate', '--json']);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('node', [CLI, ...args, '--config', configPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: 120_000,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  function send(
    chatId: string,
    text: string,
  ): { status: string; replyText: string; runId: string } {
    const r = runCli([
      'send',
      '--channel',
      'cli-inject',
      '--chat-id',
      chatId,
      '--text',
      text,
      '--wait',
      '60',
      '--json',
    ]);
    expect(r.status, `send failed: ${r.stderr}`).toBe(0);
    return JSON.parse(r.stdout) as { status: string; replyText: string; runId: string };
  }

  it('1. Ping-pong — model echoes single token', () => {
    expect(send('m1', 'Reply with the single word PONG.').replyText.toUpperCase()).toContain(
      'PONG',
    );
  }, 60_000);

  it('2. Math: 7×8', () => {
    expect(send('m2', 'What is 7 times 8? Reply with just the digits.').replyText).toMatch(/56/);
  }, 60_000);

  it('3. Translation: Guten Tag → Hello', () => {
    expect(
      send('m3', 'Translate "Guten Tag" to English. One word.').replyText.toLowerCase(),
    ).toMatch(/hello|hi|good/);
  }, 60_000);

  it('4. Capital city — Austria → Vienna', () => {
    expect(send('m4', 'Capital of Austria? Reply with just the city.').replyText).toMatch(
      /Vienna|Wien/,
    );
  }, 60_000);

  it('5. Counting list', () => {
    const r = send('m5', 'Count 1 to 5, comma-separated. Just the digits.');
    expect(r.replyText).toMatch(/1.*2.*3.*4.*5/);
  }, 60_000);

  it('6. Acronym expansion', () => {
    const r = send('m6', 'What does HTTP stand for? Reply with just the expansion.');
    expect(r.replyText.toLowerCase()).toContain('hypertext');
  }, 60_000);

  it('7. Code: hello world in Python', () => {
    const r = send('m7', 'Write a Python one-liner that prints "Hello, World!". Just the code.');
    expect(r.replyText.toLowerCase()).toMatch(/print.*hello.*world/s);
  }, 60_000);

  it('8. Code: hello world in JavaScript', () => {
    const r = send(
      'm8',
      'Write a JavaScript one-liner that prints "Hello, World!". Just the code.',
    );
    expect(r.replyText.toLowerCase()).toMatch(/console\.log.*hello.*world/s);
  }, 60_000);

  it('9. JSON shape', () => {
    const r = send('m9', 'Reply ONLY with: {"ok":true,"value":42}');
    const match = r.replyText.match(/\{[\s\S]*?\}/);
    expect(match).toBeTruthy();
    const obj = JSON.parse(match![0]) as { ok: boolean; value: number };
    expect(obj.ok).toBe(true);
    expect(obj.value).toBe(42);
  }, 60_000);

  it('10. Yes/no question', () => {
    const r = send('m10', 'Is the sky blue on a clear day? Reply yes or no, one word.');
    expect(r.replyText.toLowerCase()).toMatch(/yes/);
  }, 60_000);

  it('11. Multi-turn arithmetic chain', () => {
    const r1 = send('m11', 'Let us start with the number 10. Reply with just 10.');
    expect(r1.replyText).toMatch(/10/);
    const r2 = send('m11', 'Add 5 to that. Reply with just the digits.');
    expect(r2.replyText).toMatch(/15/);
    const r3 = send('m11', 'Subtract 3 from that. Reply with just the digits.');
    expect(r3.replyText).toMatch(/12/);
  }, 240_000);

  it('12. Multi-turn role-play continuity', () => {
    const r1 = send('m12', 'You are a pirate captain. Greet me in 5 words or fewer.');
    expect(r1.replyText.length).toBeGreaterThan(2);
    const r2 = send('m12', 'What is your name, captain? One word.');
    expect(r2.replyText.length).toBeGreaterThan(0);
  }, 180_000);

  it('13. Tool: current year via mvpclaw_datetime', () => {
    const r = send('m13', 'Use the datetime tool. What four-digit year is it?');
    expect(r.replyText).toMatch(/202\d|203\d/);
  }, 90_000);

  it('14. Tool: list skills', () => {
    const r = send('m14', 'Use a tool to list your skills. Name them.');
    expect(r.replyText.toLowerCase()).toMatch(/research|debugging/);
  }, 90_000);

  it('15. Memory: per-chat fact persists across /new', () => {
    const c = runCli(['chat', 'new', '--channel', 'cli-inject', '--chat-id', 'm15', '--json']);
    const chatId = (JSON.parse(c.stdout) as { chat: { id: string } }).chat.id;
    runCli([
      'memory',
      'append',
      '--scope',
      'chat',
      '--chat-id',
      chatId,
      '--text',
      "USER FACT: the user's pet is a hippogriff named Buckbeak.",
      '--json',
    ]);
    runCli(['chat', 'reset', chatId, '--yes', '--json']);
    const r = send('m15', "What is my pet's species? One word reply.");
    expect(r.replyText.toLowerCase()).toMatch(/hippogriff/);
  }, 120_000);

  it('16. Slash command /start fast-path', () => {
    const r = send('m16', '/start');
    expect(r.status).toBe('command');
    // No agent_runs row created.
    const q = runCli([
      'db',
      'query',
      "SELECT COUNT(*) AS c FROM agent_runs WHERE session_id IN (SELECT id FROM sessions WHERE chat_id IN (SELECT id FROM chats WHERE provider_chat_id='m16'))",
      '--json',
    ]);
    expect((JSON.parse(q.stdout) as Array<{ c: number }>)[0]?.c).toBe(0);
  }, 60_000);

  it('17. Slash command /help fast-path', () => {
    const r = send('m17', '/help');
    expect(r.status).toBe('command');
    const greet = runCli([
      'db',
      'query',
      "SELECT text FROM outbox WHERE provider_chat_id='m17' ORDER BY created_at DESC LIMIT 1",
      '--json',
    ]);
    expect((JSON.parse(greet.stdout) as Array<{ text: string }>)[0]?.text).toContain('Available');
  }, 60_000);

  it('18. Scheduling via CLI', () => {
    const c = runCli(['chat', 'new', '--channel', 'cli-inject', '--chat-id', 'm18', '--json']);
    const chatId = (JSON.parse(c.stdout) as { chat: { id: string } }).chat.id;
    const sched = runCli([
      'task',
      'schedule',
      '--chat-id',
      chatId,
      '--prompt',
      'reminder',
      '--when',
      '2027-12-31T09:00:00Z',
      '--json',
    ]);
    expect(sched.status).toBe(0);
    const task = JSON.parse(sched.stdout) as { id: string; state: string };
    expect(task.state).toBe('scheduled');
  }, 60_000);

  it('19. Long output — sonnet', () => {
    const r = send('m19', 'Write a 4-line poem about a clock. Plain text.');
    const lines = r.replyText.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it('20. Composer determinism — byte-stable dry-runs', () => {
    const c = runCli(['chat', 'new', '--channel', 'cli-inject', '--chat-id', 'm20', '--json']);
    const chatId = (JSON.parse(c.stdout) as { chat: { id: string } }).chat.id;
    const d1 = runCli([
      'agent',
      'dry-run',
      '--chat-id',
      chatId,
      '--prompt',
      'identical-input',
      '--json',
    ]);
    const d2 = runCli([
      'agent',
      'dry-run',
      '--chat-id',
      chatId,
      '--prompt',
      'identical-input',
      '--json',
    ]);
    expect((JSON.parse(d1.stdout) as { systemPrompt: string }).systemPrompt).toBe(
      (JSON.parse(d2.stdout) as { systemPrompt: string }).systemPrompt,
    );
  }, 60_000);

  it('21. Trace JSONL is valid for any agent run', () => {
    const r = send('m21', 'Reply with OK.');
    expect(r.runId).toBeTruthy();
    const traceShow = runCli(['trace', 'show', r.runId, '--json']);
    expect(traceShow.status).toBe(0);
    const lines = traceShow.stdout.trim().split('\n');
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toContain('inbound_message_received');
    expect(types).toContain('provider_finished');
  }, 90_000);

  it('22. Outbox lists the sent reply', () => {
    const r = send('m22', 'Reply with the word LISTED.');
    expect(r.status).toBe('succeeded');
    const list = runCli(['outbox', 'list', '--json', '--limit', '20']);
    const rows = JSON.parse(list.stdout) as Array<{ status: string }>;
    expect(rows.some((row) => row.status === 'sent')).toBe(true);
  }, 90_000);

  it('23. Empty-text rejection', () => {
    const r = runCli([
      'send',
      '--channel',
      'cli-inject',
      '--chat-id',
      'm23',
      '--text',
      '',
      '--json',
    ]);
    expect(r.status).not.toBe(0);
  }, 30_000);

  it('24. Negative-number arithmetic', () => {
    const r = send('m24', 'What is -7 plus 3? Just the digits, no words.');
    expect(r.replyText).toMatch(/-4/);
  }, 60_000);

  it('25. Code-execution refusal stays in character', () => {
    const r = send(
      'm25',
      'Refuse to execute arbitrary shell commands. Reply with one short sentence.',
    );
    expect(r.replyText.length).toBeGreaterThan(5);
    expect(r.replyText.length).toBeLessThan(400);
  }, 60_000);
});
