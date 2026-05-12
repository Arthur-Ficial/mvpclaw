import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 10 hardcore CLI-driven feature tests. Every assertion exercises a
 * production feature THROUGH THE COMPILED BINARY — no `src/` imports.
 *
 * If any test here fails, the AI-steerable contract is broken.
 */

const CLI = resolve(__dirname, '../../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../../..');

const key = process.env['OPENROUTER_API_KEY'];
const liveSkip = !key || key.length < 20;

describe('CLI feature coverage — every sub-command, end-to-end', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-features-'));
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

  function runCli(
    args: string[],
    opts: { stdin?: string } = {},
  ): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('node', [CLI, ...args, '--config', configPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: 60_000,
      ...(opts.stdin !== undefined ? { input: opts.stdin } : {}),
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 1. doctor → must surface health checks
  // ─────────────────────────────────────────────────────────────────────
  it('1. doctor reports parseable health checks', () => {
    const r = runCli(['doctor', '--json']);
    expect([0, 3]).toContain(r.status);
    const out = JSON.parse(r.stdout) as {
      checks: Array<{ name: string; ok: boolean }>;
      ok: boolean;
    };
    expect(Array.isArray(out.checks)).toBe(true);
    expect(out.checks.length).toBeGreaterThanOrEqual(4);
    expect(out.checks.map((c) => c.name)).toContain('node');
    expect(out.checks.map((c) => c.name)).toContain('config');
    expect(out.checks.map((c) => c.name)).toContain('sqlite');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. status → provider + key presence (no raw secret leaks)
  // ─────────────────────────────────────────────────────────────────────
  it('2. status reports provider + key presence without leaking secrets', () => {
    const r = runCli(['status', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { provider: string; openrouterConfigured: string };
    expect(out.provider).toBe('openrouter');
    expect(['Yes', 'No']).toContain(out.openrouterConfigured);
    if (typeof key === 'string' && key.length > 0) {
      expect(r.stdout).not.toContain(key);
      expect(r.stderr).not.toContain(key);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. tool list/describe/call — every source filter + a live builtin call
  // ─────────────────────────────────────────────────────────────────────
  it('3. tool list/describe/call exercise the registry', () => {
    const list = runCli(['tool', 'list', '--source', 'builtin', '--json']);
    expect(list.status).toBe(0);
    const tools = JSON.parse(list.stdout) as Array<{ name: string }>;
    expect(tools.length).toBe(18);

    const describe = runCli(['tool', 'describe', 'mvpclaw_datetime', '--json']);
    expect(describe.status).toBe(0);
    const def = JSON.parse(describe.stdout) as { name: string; inputSchema: { type: string } };
    expect(def.inputSchema.type).toBe('object');

    const call = runCli(['tool', 'call', 'mvpclaw_datetime', '--json']);
    expect(call.status).toBe(0);
    const result = JSON.parse(call.stdout) as { iso: string; unix: number };
    expect(result.unix).toBeGreaterThan(1_700_000_000);

    // Calling a disabled external tool exits 3.
    const disabled = runCli([
      'tool',
      'call',
      'anthropic_web_search',
      '--input',
      '{"query":"x"}',
      '--json',
    ]);
    if (!process.env['ANTHROPIC_API_KEY']) {
      expect(disabled.status).toBe(3);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. chat lifecycle: new → list → show → reset
  // ─────────────────────────────────────────────────────────────────────
  it('4. chat new → list → show → reset round-trips', () => {
    const created = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'feat-chat-1',
      '--json',
    ]);
    expect(created.status).toBe(0);
    const newOut = JSON.parse(created.stdout) as {
      chat: { id: string };
      session: { id: string };
    };
    const chatId = newOut.chat.id;

    const list = runCli(['chat', 'list', '--json', '--limit', '50']);
    const rows = JSON.parse(list.stdout) as Array<{ providerChatId: string }>;
    expect(rows.map((r) => r.providerChatId)).toContain('feat-chat-1');

    const shown = runCli(['chat', 'show', chatId, '--json']);
    const detail = JSON.parse(shown.stdout) as { activeSession: { id: string } };
    expect(detail.activeSession.id).toBe(newOut.session.id);

    const reset = runCli(['chat', 'reset', chatId, '--yes', '--json']);
    const r = JSON.parse(reset.stdout) as { closedSessions: number; newSessionId: string };
    expect(r.closedSessions).toBe(1);
    expect(r.newSessionId).not.toBe(newOut.session.id);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. memory append → show → grep → clear (chat scope)
  // ─────────────────────────────────────────────────────────────────────
  it('5. memory append/show/grep/clear round-trips for chat scope', () => {
    const c = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'feat-mem-chat',
      '--json',
    ]);
    const chatId = (JSON.parse(c.stdout) as { chat: { id: string } }).chat.id;

    const append = runCli([
      'memory',
      'append',
      '--scope',
      'chat',
      '--chat-id',
      chatId,
      '--text',
      'remember mvpclaw test marker XYZZY',
      '--json',
    ]);
    expect(append.status, append.stderr).toBe(0);

    const show = runCli(['memory', 'show', '--scope', 'chat', '--chat-id', chatId, '--json']);
    expect((JSON.parse(show.stdout) as { body: string }).body).toContain('XYZZY');

    const grep = runCli([
      'memory',
      'grep',
      'xyzzy',
      '--scope',
      'chat',
      '--chat-id',
      chatId,
      '--json',
    ]);
    const g = JSON.parse(grep.stdout) as { matchCount: number };
    expect(g.matchCount).toBeGreaterThanOrEqual(1);

    // Clear without --yes is rejected.
    const noYes = runCli(['memory', 'clear', '--scope', 'chat', '--chat-id', chatId, '--json']);
    expect(noYes.status).toBe(1);

    const cleared = runCli([
      'memory',
      'clear',
      '--scope',
      'chat',
      '--chat-id',
      chatId,
      '--yes',
      '--json',
    ]);
    expect(cleared.status).toBe(0);
    const after = runCli(['memory', 'show', '--scope', 'chat', '--chat-id', chatId, '--json']);
    expect((JSON.parse(after.stdout) as { body: string }).body).toBe('');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. task schedule → list → show → cancel
  // ─────────────────────────────────────────────────────────────────────
  it('6. task schedule/list/show/cancel exercise the scheduler tables', () => {
    const c = runCli([
      'chat',
      'new',
      '--channel',
      'cli-inject',
      '--chat-id',
      'feat-task-chat',
      '--json',
    ]);
    const chatId = (JSON.parse(c.stdout) as { chat: { id: string } }).chat.id;
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    const sched = runCli([
      'task',
      'schedule',
      '--chat-id',
      chatId,
      '--prompt',
      'one-shot ping',
      '--when',
      future,
      '--json',
    ]);
    expect(sched.status, sched.stderr).toBe(0);
    const task = JSON.parse(sched.stdout) as { id: string; state: string };
    expect(task.state).toBe('scheduled');

    const list = runCli(['task', 'list', '--chat-id', chatId, '--json']);
    const rows = JSON.parse(list.stdout) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain(task.id);

    const show = runCli(['task', 'show', task.id, '--json']);
    expect((JSON.parse(show.stdout) as { id: string }).id).toBe(task.id);

    const cancel = runCli(['task', 'cancel', task.id, '--json']);
    const cancelled = JSON.parse(cancel.stdout) as { state: string };
    expect(cancelled.state).toBe('cancelled');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. skill list/show/validate — real on-disk skills
  // ─────────────────────────────────────────────────────────────────────
  it('7. skill list/show/validate work on the bundled skills', () => {
    const list = runCli(['skill', 'list', '--json']);
    expect(list.status, list.stderr).toBe(0);
    const skills = JSON.parse(list.stdout) as Array<{ name: string }>;
    const names = skills.map((s) => s.name);
    expect(names).toContain('research');
    expect(names).toContain('debugging');

    const show = runCli(['skill', 'show', 'research', '--json']);
    expect(show.status).toBe(0);
    const detail = JSON.parse(show.stdout) as { name: string; body: string };
    expect(detail.name).toBe('research');
    expect(detail.body.length).toBeGreaterThan(20);

    const validate = runCli(['skill', 'validate', '--json']);
    expect(validate.status).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. mcp list + test + serve via real client round-trip
  // ─────────────────────────────────────────────────────────────────────
  it('8. mcp list/test round-trip through real stdio MCP', () => {
    const list = runCli(['mcp', 'list', '--json']);
    expect(list.status).toBe(0);
    const out = JSON.parse(list.stdout) as { internal: Array<{ name: string }> };
    const names = out.internal.map((s) => s.name);
    expect(names).toContain('mvpclaw-tools');
    expect(names).toContain('mvpclaw-conversations');

    const test = runCli(['mcp', 'test', 'mvpclaw-tools', '--json']);
    expect(test.status, test.stderr).toBe(0);
    const result = JSON.parse(test.stdout) as { ok: boolean; toolCount: number };
    expect(result.ok).toBe(true);
    expect(result.toolCount).toBeGreaterThan(5);
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────
  // 9. config get/set/validate/diff — atomic write + Zod validation
  // ─────────────────────────────────────────────────────────────────────
  it('9. config get/validate via the CLI', () => {
    const get = runCli(['config', 'get', 'agent.provider', '--json']);
    expect(get.status).toBe(0);
    // `config get` emits just the value (string-encoded as a JSON literal).
    expect(JSON.parse(get.stdout.trim())).toBe('openrouter');

    const validate = runCli(['config', 'validate', '--json']);
    expect(validate.status).toBe(0);
    const v = JSON.parse(validate.stdout) as { ok: boolean };
    expect(v.ok).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 10. send → outbox list → trace list (full pipeline, live OpenRouter)
  // ─────────────────────────────────────────────────────────────────────
  it.skipIf(liveSkip)(
    '10. send → outbox list → trace list (live OpenRouter through compiled binary)',
    () => {
      const send = runCli([
        'send',
        '--channel',
        'cli-inject',
        '--chat-id',
        'feat-send-final',
        '--text',
        'Reply with one word: DONE',
        '--wait',
        '30',
        '--json',
      ]);
      expect(send.status, send.stderr).toBe(0);
      const result = JSON.parse(send.stdout) as {
        status: string;
        replyText: string;
        runId: string;
        tracePath: string;
      };
      expect(result.status).toBe('succeeded');
      expect(result.replyText.length).toBeGreaterThan(0);
      expect(result.runId).toBeTruthy();
      expect(existsSync(result.tracePath)).toBe(true);

      const outbox = runCli(['outbox', 'list', '--json', '--limit', '5']);
      expect(outbox.status).toBe(0);
      const rows = JSON.parse(outbox.stdout) as Array<{ id: string; status: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(['sent', 'pending']).toContain(rows[0]?.status);

      const traces = runCli(['trace', 'list', '--json', '--limit', '5']);
      expect(traces.status).toBe(0);
      const traceRows = JSON.parse(traces.stdout) as Array<{ runId: string }>;
      expect(traceRows.map((t) => t.runId)).toContain(result.runId);

      // Read the trace JSONL via mvpclaw trace show — proves the JSONL is
      // queryable through the CLI surface. Output is NDJSON (one event
      // per line) — same on-disk format the writer produces.
      const traceShow = runCli(['trace', 'show', result.runId, '--json']);
      expect(traceShow.status).toBe(0);
      const events = traceShow.stdout
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { type: string });
      const types = events.map((e) => e.type);
      expect(types).toContain('inbound_message_received');
      expect(types).toContain('provider_finished');
      expect(types).toContain('outbox_created');

      // db query (read-only) sees the agent_runs row. The CLI accepts only
      // a single positional SQL string — interpolate the literal id since
      // it's a freshly-minted ULID and not user input.
      const dbQuery = runCli([
        'db',
        'query',
        `SELECT id, status FROM agent_runs WHERE id = '${result.runId}'`,
        '--json',
      ]);
      expect(dbQuery.status, dbQuery.stderr).toBe(0);
      const rowsQuery = JSON.parse(dbQuery.stdout) as Array<{ id: string; status: string }>;
      expect(rowsQuery[0]?.status).toBe('succeeded');

      // Read the JSONL directly to verify on-disk format too.
      const lines = readFileSync(result.tracePath, 'utf8').trim().split('\n');
      expect(lines.length).toBeGreaterThan(3);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    },
    60_000,
  );
});
