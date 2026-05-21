/**
 * Audit: video pipeline routing.
 *
 * Telegram Bot API exposes TWO distinct endpoints:
 *   - POST /bot<token>/sendPhoto  — for images (JPEG, PNG, WebP, GIF)
 *   - POST /bot<token>/sendVideo  — for videos (MP4, WebM)
 *
 * They are NOT interchangeable. Sending an MP4 to /sendPhoto fails server-side
 * with `Bad Request: PHOTO_INVALID_DIMENSIONS` (Telegram tries to decode the
 * payload as an image and rejects it).
 *
 * Hypothesis being audited: `telegram_photo` lacks extension validation, so an
 * LLM that calls `telegram_photo` with an `.mp4` path will route the upload to
 * /sendPhoto, where Telegram rejects it. The fix mirrors what `telegram_video`
 * already does at power-tools.ts:538-543 (reject non-mp4/webm with a clear
 * message pointing at the correct tool).
 *
 * These tests mock `globalThis.fetch` so no real HTTP happens.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { openDb, applyMigrations } from '../../src/db/index.js';
import { createToolRegistry } from '../../src/tools/index.js';
import { registerPowerTools } from '../../src/tools/power-tools.js';

function freshRegistry(): {
  db: ReturnType<typeof openDb>;
  registry: ReturnType<typeof createToolRegistry>;
} {
  const db = openDb(':memory:');
  applyMigrations(db, resolve(__dirname, '../../migrations'));
  const config = loadConfig(resolve(__dirname, '../../mvpclaw.config.json'));
  const registry = createToolRegistry();
  registerPowerTools(registry, config);
  return { db, registry };
}

describe('telegram photo/video — MIME-aware routing', () => {
  let tmp: string;
  let prevToken: string | undefined;
  const fetchCalls: Array<{ url: string }> = [];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-mime-'));
    prevToken = process.env['TELEGRAM_BOT_TOKEN'];
    process.env['TELEGRAM_BOT_TOKEN'] = 'fake:fake-token-1234567890';
    fetchCalls.length = 0;
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        fetchCalls.push({ url });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    if (prevToken === undefined) {
      delete process.env['TELEGRAM_BOT_TOKEN'];
    } else {
      process.env['TELEGRAM_BOT_TOKEN'] = prevToken;
    }
  });

  it('telegram_photo with .jpg → hits /sendPhoto (baseline)', async () => {
    const path = join(tmp, 'cat.jpg');
    writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // JPEG magic
    const { db, registry } = freshRegistry();

    const result = await registry.call('telegram_photo', { chatId: '123', path }, { db });

    expect(result).toEqual({ ok: true, messageId: 999 });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toMatch(/\/sendPhoto$/);
  });

  // THE BUG — currently telegram_photo has NO extension validation.
  // Expected: reject .mp4 before fetch, naming telegram_video as the fix.
  // Actual:   silently uploads MP4 to /sendPhoto; Telegram returns
  //           "Bad Request: PHOTO_INVALID_DIMENSIONS" at runtime.
  it('telegram_photo with .mp4 → MUST reject and point at telegram_video', async () => {
    const path = join(tmp, 'clip.mp4');
    writeFileSync(path, Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])); // mp4 ftyp
    const { db, registry } = freshRegistry();

    await expect(registry.call('telegram_photo', { chatId: '123', path }, { db })).rejects.toThrow(
      /telegram_video|\.mp4|video/i,
    );

    // And critically: must NOT have shipped the MP4 to /sendPhoto.
    const photoCalls = fetchCalls.filter((c) => c.url.includes('/sendPhoto'));
    expect(photoCalls).toHaveLength(0);
  });

  it('telegram_video with .mp4 → hits /sendVideo (baseline)', async () => {
    const path = join(tmp, 'clip.mp4');
    writeFileSync(path, Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]));
    const { db, registry } = freshRegistry();

    const result = await registry.call('telegram_video', { chatId: '123', path }, { db });

    expect(result).toEqual({ ok: true, messageId: 999 });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toMatch(/\/sendVideo$/);
  });

  it('telegram_video with .jpg → rejects before fetch (existing validation)', async () => {
    const path = join(tmp, 'cat.jpg');
    writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const { db, registry } = freshRegistry();

    await expect(registry.call('telegram_video', { chatId: '123', path }, { db })).rejects.toThrow(
      /mp4|webm/i,
    );

    expect(fetchCalls).toHaveLength(0);
  });
});
