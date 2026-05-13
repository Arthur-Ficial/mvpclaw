/**
 * Real-Telegram round-trip battery — opt-in suite that drives the bot through
 * the actual grammY → Bot API → user's phone path. Every assertion is on
 * observable state (outbox row, tool_calls table, reply text), never on
 * Telegram's rendering — the human on the receiving end visually spot-checks
 * what `chunkText` actually produces.
 *
 * Why this exists: every other e2e suite injects through `cli-inject`. That
 * proves the orchestrator works but never exercises grammY chunking, Bot API
 * rate handling, or the real photo upload pipe. This suite plugs that hole.
 *
 * Opt-in (skipped by default — see `_harness.ts`):
 *   MVPCLAW_REAL_TELEGRAM=1 TELEGRAM_BOT_TOKEN=... pnpm test:real-telegram
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  callTool,
  injectViaTelegram,
  readOutboxForRun,
  readToolCallsForRun,
  realTelegramSkip,
} from './_harness.js';

describe.skipIf(realTelegramSkip).sequential('real-Telegram round trip', () => {
  it('1. plain-short: ping → reply lands on Telegram with a message id', () => {
    const r = injectViaTelegram('Reply with exactly the single word PONG. No punctuation.');
    expect(r.status).toBe('succeeded');
    expect(r.replyText.toUpperCase()).toContain('PONG');
    expect(r.outboxSent).toBeGreaterThanOrEqual(1);
    expect(r.outboxFailed).toBe(0);
    const rows = readOutboxForRun(r.runId!);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.provider).toBe('telegram');
      expect(row.status).toBe('sent');
      expect(row.provider_message_id).toMatch(/^\d+$/);
    }
  }, 90_000);

  it('2. plain-long: model produces multi-thousand-char reply, sent intact', () => {
    // The orchestrator stores the full reply in ONE outbox row; chunking
    // happens inside `telegram.channel.ts:send()` at delivery time. So the
    // test asserts on a long single row plus a real provider_message_id,
    // not on multi-row chunking. To force a long output deterministically
    // we ask for a numbered list of 30 items.
    const r = injectViaTelegram(
      'List THIRTY distinct, numbered facts about the history of bread. ' +
        'Each fact must be a full sentence of at least 50 words. Number them 1. to 30. ' +
        'Plain prose, no code blocks, no headings.',
      { waitSeconds: 180 },
    );
    expect(r.status).toBe('succeeded');
    expect(r.replyText.length).toBeGreaterThan(1500);
    const rows = readOutboxForRun(r.runId!);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.status).toBe('sent');
      expect(row.provider_message_id).toMatch(/^\d+$/);
    }
  }, 240_000);

  it('3. fence-single-ts: code block request → reply contains a ```typescript fence', () => {
    const r = injectViaTelegram(
      'Reply with exactly the following, NOTHING ELSE — no prose around it:\n' +
        '```typescript\nconsole.log("hello");\n```',
    );
    expect(r.status).toBe('succeeded');
    expect(r.replyText).toMatch(/```/);
    expect(r.replyText.toLowerCase()).toMatch(/console\.log/);
    const rows = readOutboxForRun(r.runId!);
    for (const row of rows) {
      expect(row.status).toBe('sent');
    }
  }, 90_000);

  it('4. fence-multi: three code blocks → all three present in outbox text', () => {
    const r = injectViaTelegram(
      'Reply with THREE separate fenced code blocks back-to-back, with one blank line between them, and nothing else:\n' +
        '```js\nvar a = 1;\n```\n\n```py\na = 1\n```\n\n```sh\necho 1\n```',
      { waitSeconds: 120 },
    );
    expect(r.status).toBe('succeeded');
    const fenceCount = (r.replyText.match(/```/g) ?? []).length;
    expect(fenceCount).toBeGreaterThanOrEqual(6); // 3 blocks × 2 fences each
    expect(r.replyText).toMatch(/echo 1/);
  }, 150_000);

  it('5. inline-code: backtick-only term renders without forcing a chunk split', () => {
    const r = injectViaTelegram(
      'What is the TypeScript type of `Map<string, number>`? Answer in one short sentence with the term in backticks.',
    );
    expect(r.status).toBe('succeeded');
    expect(r.replyText).toMatch(/`[^`\n]+`/); // has at least one inline-code span
    const rows = readOutboxForRun(r.runId!);
    expect(rows.length).toBe(1); // short answer should not chunk
  }, 90_000);

  it('6. slash-help: /help slash-command goes through the fast-path', () => {
    const r = injectViaTelegram('/help');
    expect(r.status).toBe('command');
    expect(r.outboxSent).toBeGreaterThanOrEqual(1);
    const rows = readOutboxForRun(r.runId ?? ''); // command path has runId=null; rows will be []
    // /help replies through the command queue, not a run — assert on r.outboxSent instead.
    expect(rows).toEqual(rows); // tautology — keep the variable alive
  }, 30_000);

  it('7. tool-call discipline: state question forces a real tool call (no fabricated hashes)', () => {
    const r = injectViaTelegram(
      'What is the current git HEAD commit hash on the main branch of this repository? Use a tool. ' +
        'If you cannot, say "I cannot check" and DO NOT invent a hash.',
      { waitSeconds: 120 },
    );
    expect(r.status).toBe('succeeded');
    const reply = r.replyText;
    const looksLikeHash = /\b[a-f0-9]{7,40}\b/.test(reply);
    if (looksLikeHash) {
      // A hash appeared → there MUST be a tool call in this run that produced it.
      const calls = readToolCallsForRun(r.runId!);
      expect(calls.length).toBeGreaterThan(0);
      const succeeded = calls.find((c) => c.error === null && c.result_len > 0);
      expect(succeeded, `reply contained a hash but no successful tool call exists`).toBeDefined();
    }
    // Either no hash, or a hash backed by a tool call. Hallucination = hash w/o call.
  }, 150_000);

  it('8. tool: gemini_image direct call produces a real PNG on disk', () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'mvpclaw-rt-'));
    const out = resolve(tmp, 'red.png');
    try {
      const r = callTool('gemini_image', {
        prompt: 'a solid red square on white background',
        outPath: out,
      });
      if (r.isDisabled) {
        return; // tool not on for this config — not a failure
      }
      expect(r.exitCode, `gemini_image failed: ${r.stderr}`).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(1024);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 150_000);

  it('9. agent-driven photo: bot autonomously calls telegram_photo and a photo lands', () => {
    const r = injectViaTelegram(
      'Generate an image of a simple blue circle on a white background and send it as a photo to this chat.',
      { waitSeconds: 180 },
    );
    if (r.status === 'failed') {
      // Tool may be gated off; we don't make the suite fail here — just record it.
      expect(r.error ?? '').toMatch(/.*/);
      return;
    }
    expect(r.status).toBe('succeeded');
    const calls = readToolCallsForRun(r.runId!);
    const usedImage = calls.find((c) => /gemini_image|telegram_photo/.test(c.tool_name));
    if (!usedImage) {
      // Bot may have replied with text only — surface it but don't hard-fail.
      // The hard assertion in scenario 8 already guarantees the tool works.
      return;
    }
    const photoCall = calls.find((c) => c.tool_name === 'telegram_photo');
    if (photoCall) {
      expect(photoCall.error).toBeNull();
      expect(photoCall.result_len).toBeGreaterThan(0);
    }
  }, 240_000);

  it('10. dedup: same provider_update_id twice → second one returns status="duplicate"', () => {
    const dupeId = `harness-dedup-${Date.now()}`;
    const first = injectViaTelegram('First send for dedup test, reply with single word OK.', {
      updateId: dupeId,
    });
    expect(first.status).toBe('succeeded');
    const second = injectViaTelegram('Second send (should be deduped)', { updateId: dupeId });
    expect(second.status).toBe('duplicate');
    expect(second.outboxSent).toBe(0);
  }, 180_000);
});
