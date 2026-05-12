import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { createOpenRouterProvider } from '../../src/agent/index.js';
import { createCliInjectChannel } from '../../src/channels/index.js';
import { MvpClawConfig } from '../../src/config/index.js';
import { applyMigrations, openDb, OutboxRepo } from '../../src/db/index.js';
import { drainOutbox, routeInbound, runAgentTurn, type AppContext } from '../../src/app/index.js';

const MIGRATIONS = resolve(__dirname, '../../migrations');

/**
 * P4 end-to-end test — drives a real round-trip:
 *
 *   cli-inject channel  →  router  →  orchestrator
 *                                      ↓
 *                               OpenRouter (REAL, free model)
 *                                      ↓
 *                                   outbox
 *                                      ↓
 *                               channel.send()
 *
 * Per project policy: NO FAKE PROVIDERS. This test hits the real
 * OpenRouter API using the free model (`meta-llama/llama-3.2-3b-instruct:free`).
 * The test is gated by the `OPENROUTER_API_KEY` env var — if absent the
 * test is skipped so the CI doesn't fail in environments without a key.
 *
 * `--nocache` is the canonical run; we exercise the real provider every time.
 */

const key = process.env['OPENROUTER_API_KEY'];
const skip = !key || key.length < 20;

describe.skipIf(skip)('orchestrator end-to-end (real OpenRouter, free model)', () => {
  let tmp: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-e2e-'));
    // Use the cheap-but-reliable `openai/gpt-4o-mini` (~$0.0001/call) so
    // tests aren't flaky. The default config's free model is fine for the
    // end-user but rate-limited upstream too aggressively for CI.
    const config = MvpClawConfig.parse({
      app: { dataDir: tmp, workspaceDir: join(tmp, 'workspace') },
      database: { url: `file:${join(tmp, 'db.sqlite')}` },
      agent: { provider: 'openrouter' },
      openrouter: { defaultModel: 'openai/gpt-4o-mini' },
    });
    const db = openDb(join(tmp, 'db.sqlite'));
    applyMigrations(db, MIGRATIONS);

    const cliInject = createCliInjectChannel();
    const openrouter = createOpenRouterProvider({
      apiKey: key as string,
      baseUrl: config.openrouter.baseUrl,
      model: config.openrouter.defaultModel,
      title: 'mvpclaw-integration-tests',
    });

    ctx = {
      config,
      log: pino({ level: 'silent' }),
      db,
      channels: { 'cli-inject': cliInject },
      providers: { openrouter },
      tracesDir: join(tmp, 'traces'),
    };
  });

  afterEach(() => {
    ctx.db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('drives a real round-trip: cli-inject → orchestrator → OpenRouter → outbox', async () => {
    const inbound = {
      id: 'cli-inject:01TEST',
      channel: 'cli-inject',
      providerUpdateId: 'cli-upd-1',
      providerChatId: 'chat-1',
      providerUserId: 'user-1',
      text: 'Reply with exactly the word OK and nothing else.',
      receivedAt: new Date().toISOString(),
    };
    const resolved = routeInbound(ctx.db, inbound);
    expect(resolved.isDuplicate).toBe(false);
    expect(resolved.isHandledCommand).toBe(false);

    const result = await runAgentTurn(ctx, resolved);
    expect(result.status, `agent run failed: ${result.error ?? ''}`).toBe('succeeded');
    expect(result.replyText.length).toBeGreaterThan(0);
    expect(existsSync(result.tracePath)).toBe(true);

    // Trace JSONL contains the expected event types in order.
    const lines = readFileSync(result.tracePath, 'utf8').trim().split('\n');
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toContain('inbound_message_received');
    expect(types).toContain('prompt_built');
    expect(types).toContain('provider_started');
    expect(types).toContain('outbox_created');
    expect(types).toContain('provider_finished');

    // Outbox row exists in 'pending'.
    const pending = OutboxRepo.listOutbox(ctx.db, { status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toBe(result.replyText);

    // Drain outbox via the cli-inject channel — its send() is a no-op
    // (writes to stderr) so the row transitions cleanly to 'sent'.
    const drain = await drainOutbox(ctx);
    expect(drain.sent).toBe(1);
    expect(drain.failed).toBe(0);

    const sent = OutboxRepo.listOutbox(ctx.db, { status: 'sent' });
    expect(sent).toHaveLength(1);
  }, 60_000);

  it('dedups: same providerUpdateId twice yields one agent run', async () => {
    const inbound = {
      id: 'cli-inject:01TEST',
      channel: 'cli-inject',
      providerUpdateId: 'cli-upd-dedup',
      providerChatId: 'chat-2',
      providerUserId: 'user-1',
      text: 'Say OK.',
      receivedAt: new Date().toISOString(),
    };
    const first = routeInbound(ctx.db, inbound);
    expect(first.isDuplicate).toBe(false);
    await runAgentTurn(ctx, first);

    const second = routeInbound(ctx.db, inbound);
    expect(second.isDuplicate).toBe(true);
    // Dedup hit — we DON'T call runAgentTurn here. The orchestrator's caller
    // (the daemon) checks `isDuplicate` and skips.

    const runs = ctx.db.prepare('SELECT COUNT(*) AS c FROM agent_runs').get() as { c: number };
    expect(runs.c).toBe(1);
  }, 60_000);

  it('built-in /start command does not call the model', async () => {
    const inbound = {
      id: 'cli-inject:01TEST',
      channel: 'cli-inject',
      providerUpdateId: 'cli-upd-start',
      providerChatId: 'chat-3',
      providerUserId: 'user-1',
      text: '/start',
      receivedAt: new Date().toISOString(),
    };
    const resolved = routeInbound(ctx.db, inbound);
    expect(resolved.isHandledCommand).toBe(true);

    // No agent runs created.
    const runs = ctx.db.prepare('SELECT COUNT(*) AS c FROM agent_runs').get() as { c: number };
    expect(runs.c).toBe(0);

    // Outbox got the greeting.
    const pending = OutboxRepo.listOutbox(ctx.db, { status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toContain("Hi! I'm MVPClaw");
  });
});
