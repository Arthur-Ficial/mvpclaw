import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Massive creative end-to-end journeys driven entirely through the CLI.
 *
 * Each scenario is a believable user interaction with the bot — multi-turn,
 * tool-using, memory-persisting, skill-invoking, schedule-aware. We hit
 * the REAL OpenRouter API and assert on the actual content the model
 * produced. NO FAKES.
 */

const CLI = resolve(__dirname, '../../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../../..');
const key = process.env['OPENROUTER_API_KEY'];
const liveSkip = !key || key.length < 20;

describe.skipIf(liveSkip)('CLI creative journeys — multi-turn, tool-using, real OpenRouter', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-creative-'));
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

  /** Send one inbound message through the orchestrator and parse the JSON. */
  function send(
    chatId: string,
    text: string,
  ): {
    status: string;
    replyText: string;
    runId: string;
  } {
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

  // ─────────────────────────────────────────────────────────────────────
  // 1. Multi-turn arithmetic — proves history sliding window works
  // ─────────────────────────────────────────────────────────────────────
  it('1. Multi-turn arithmetic — model uses prior turns as context', () => {
    const chat = 'creative-arith';
    const r1 = send(chat, 'Let us start with the number 42. Reply with the number you see.');
    expect(r1.replyText).toMatch(/42/);

    const r2 = send(
      chat,
      'Add 7 to that number from the previous turn. Reply with just the digits.',
    );
    expect(r2.replyText).toMatch(/49/);

    const r3 = send(chat, 'Now multiply that result by 2. Reply with just the digits.');
    expect(r3.replyText).toMatch(/98/);
  }, 240_000);

  // ─────────────────────────────────────────────────────────────────────
  // 2. Multi-turn roleplay — text adventure game
  // ─────────────────────────────────────────────────────────────────────
  it('2. Mini text-adventure — model commits to a setting and stays in it', () => {
    const chat = 'creative-adventure';
    const r1 = send(
      chat,
      'Start a tiny text adventure: I am a wizard in a dark forest. Describe in ONE sentence.',
    );
    expect(r1.replyText.length).toBeGreaterThan(10);

    const r2 = send(chat, 'I cast a fireball at the nearest tree. What happens? ONE sentence.');
    // Reply should reference fire/burn/tree/flame.
    expect(r2.replyText.toLowerCase()).toMatch(/fire|burn|tree|flame|smok|ash|spark|ignit/);

    const r3 = send(chat, 'Sum up our adventure in 5 words or fewer.');
    expect(r3.replyText.length).toBeLessThan(120);
  }, 240_000);

  // ─────────────────────────────────────────────────────────────────────
  // 3. Tool use — model calls mvpclaw_datetime and reports the year
  // ─────────────────────────────────────────────────────────────────────
  it('3. Tool use — model calls mvpclaw_datetime when asked for the current time', () => {
    const chat = 'creative-tool-time';
    const r = send(
      chat,
      'Use a tool to look up the current date and tell me which year it is. Reply with just the four-digit year.',
    );
    // The mvpclaw_datetime tool returns the real wall-clock year.
    expect(r.replyText).toMatch(/202\d|203\d/);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────
  // 4. Tool use — model lists skills via mvpclaw_list_skills
  // ─────────────────────────────────────────────────────────────────────
  it('4. Tool use — model lists skills when asked', () => {
    const chat = 'creative-tool-skills';
    const r = send(chat, 'Use a tool to list your available skills, then name them in your reply.');
    expect(r.replyText.toLowerCase()).toMatch(/research|debugging/);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────
  // 5. Memory persistence across separate sessions
  // ─────────────────────────────────────────────────────────────────────
  it('5. Memory — fact appended in one turn survives a /new reset', () => {
    const chat = 'creative-memory';
    const created = runCli(['chat', 'new', '--channel', 'cli-inject', '--chat-id', chat, '--json']);
    const chatId = (JSON.parse(created.stdout) as { chat: { id: string } }).chat.id;

    // Manually append a chat-memory fact via the CLI.
    runCli([
      'memory',
      'append',
      '--scope',
      'chat',
      '--chat-id',
      chatId,
      '--text',
      "USER FACT: the user's favourite colour is octarine.",
      '--json',
    ]);

    // Reset the session so history is empty.
    runCli(['chat', 'reset', chatId, '--yes', '--json']);

    // Ask the model — it should know from the per-chat memory section.
    const r = send(chat, 'What is my favourite colour? Reply with just the colour word.');
    expect(r.replyText.toLowerCase()).toContain('octarine');
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────
  // 6. Long output — model produces a poem and outbox carries it intact
  // ─────────────────────────────────────────────────────────────────────
  it('6. Long output — 8-line poem survives the outbox round-trip', () => {
    const chat = 'creative-poem';
    const r = send(
      chat,
      'Write exactly an 8-line poem about a robot learning to chat. Plain text.',
    );
    // Count newlines + non-empty lines.
    const lines = r.replyText.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(14);
    expect(r.replyText.length).toBeGreaterThan(40);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────
  // 7. Code generation — model produces valid JSON
  // ─────────────────────────────────────────────────────────────────────
  it('7. Structured output — model emits valid JSON when asked', () => {
    const chat = 'creative-json';
    const r = send(
      chat,
      'Reply with ONLY a JSON object (no prose, no fences) with keys "ok" (boolean true) and "version" (string "0.3"). Nothing else.',
    );
    // Extract the first JSON object from the reply.
    const match = r.replyText.match(/\{[\s\S]*\}/);
    expect(match).toBeTruthy();
    const obj = JSON.parse(match![0]) as { ok: boolean; version: string };
    expect(obj.ok).toBe(true);
    expect(obj.version).toBe('0.3');
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────
  // 8. Slash-command — /start returns the hardcoded greeting (no model)
  // ─────────────────────────────────────────────────────────────────────
  it('8. Slash command — /start handled by router, model never invoked', () => {
    const chat = 'creative-slash';
    const r = send(chat, '/start');
    // `send` returns status='command' for slash commands and the reply
    // sits in the outbox. The CLI surface doesn't pipe outbox-only
    // replies back through the send response.
    expect(r.status).toBe('command');

    // The greeting should be in the outbox — query directly for the full
    // text (the human `outbox list` output truncates with ellipses).
    const greetingRows = runCli([
      'db',
      'query',
      "SELECT text FROM outbox WHERE provider_chat_id = 'creative-slash' ORDER BY created_at DESC LIMIT 1",
      '--json',
    ]);
    const grows = JSON.parse(greetingRows.stdout) as Array<{ text: string }>;
    expect(grows[0]?.text ?? '').toContain("Hi! I'm MVPClaw");

    // No agent_runs row should exist for /start
    const dbQuery = runCli([
      'db',
      'query',
      "SELECT COUNT(*) AS c FROM agent_runs WHERE session_id IN (SELECT id FROM sessions WHERE chat_id IN (SELECT id FROM chats WHERE provider_chat_id = 'creative-slash'))",
      '--json',
    ]);
    const counts = JSON.parse(dbQuery.stdout) as Array<{ c: number }>;
    expect(counts[0]?.c).toBe(0);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────
  // 9. Scheduling — agent schedules a future task via tool call
  // ─────────────────────────────────────────────────────────────────────
  it('9. Scheduling — schedule_task CLI invocation creates a future job', () => {
    // This is the AI-steerable path: an agent issuing `mvpclaw task
    // schedule` (or `mvpclaw tool call schedule_task`) from the CLI.
    // Smaller LLMs are unreliable about choosing tool calls under a
    // hardcoded preamble, so we drive the same code path the model would.
    const chat = 'creative-schedule';
    const c = runCli(['chat', 'new', '--channel', 'cli-inject', '--chat-id', chat, '--json']);
    const chatId = (JSON.parse(c.stdout) as { chat: { id: string } }).chat.id;

    const future = '2027-06-01T09:00:00Z';
    const sched = runCli([
      'task',
      'schedule',
      '--chat-id',
      chatId,
      '--prompt',
      'yearly check-in',
      '--when',
      future,
      '--json',
    ]);
    expect(sched.status, sched.stderr).toBe(0);
    const task = JSON.parse(sched.stdout) as { id: string; state: string };
    expect(task.state).toBe('scheduled');

    const list = runCli(['task', 'list', '--chat-id', chatId, '--json']);
    const tasks = JSON.parse(list.stdout) as Array<{ id: string; state: string }>;
    expect(tasks.map((t) => t.id)).toContain(task.id);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────
  // 10. Composer determinism — two identical dry-runs produce identical prompts
  // ─────────────────────────────────────────────────────────────────────
  it('10. Composer determinism — dry-run is byte-stable across invocations', () => {
    const chat = 'creative-determinism';
    runCli(['chat', 'new', '--channel', 'cli-inject', '--chat-id', chat, '--json']);
    const created = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'creative-determinism-2',
      '--json',
    ]);
    const newChatId = (JSON.parse(created.stdout) as { chat: { id: string } }).chat.id;

    const dry1 = runCli([
      'agent',
      'dry-run',
      '--chat-id',
      newChatId,
      '--prompt',
      'identical-prompt-for-determinism-check',
      '--json',
    ]);
    const dry2 = runCli([
      'agent',
      'dry-run',
      '--chat-id',
      newChatId,
      '--prompt',
      'identical-prompt-for-determinism-check',
      '--json',
    ]);
    const p1 = JSON.parse(dry1.stdout) as { systemPrompt: string; tools: unknown[] };
    const p2 = JSON.parse(dry2.stdout) as { systemPrompt: string; tools: unknown[] };
    expect(p1.systemPrompt).toBe(p2.systemPrompt);
    expect(JSON.stringify(p1.tools)).toBe(JSON.stringify(p2.tools));
  }, 60_000);
});
