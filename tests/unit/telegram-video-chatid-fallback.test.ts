/**
 * Pins the `chatId` fallback contract on the `telegram_video` tool — mirrors
 * the telegram_photo battery (see telegram-photo-chatid-fallback.test.ts).
 * Specifically tests the error path: when neither input nor execCtx provides
 * a chat id, the tool must throw a clear message. Success paths live in the
 * real-Telegram e2e suite.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, applyMigrations } from '../../src/db/index.js';
import { registerPowerTools } from '../../src/tools/power-tools.js';
import { createToolRegistry } from '../../src/tools/index.js';
import { loadConfig } from '../../src/config/index.js';

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

describe('telegram_video — chatId fallback contract', () => {
  it('is registered as a builtin tool', () => {
    const { registry } = freshRegistry();
    const tool = registry.describe().find((t) => t.name === 'telegram_video');
    expect(tool).toBeDefined();
    expect(tool?.source).toBe('builtin');
    expect(tool?.enabled).toBe(true);
  });

  it('throws "no chatId" when neither input.chatId nor execCtx.providerChatId is set', async () => {
    const prev = process.env['TELEGRAM_BOT_TOKEN'];
    process.env['TELEGRAM_BOT_TOKEN'] = 'fake:fake-fake-fake-fake-fake-fake-fake-fake-fake';
    try {
      const { db, registry } = freshRegistry();
      await expect(registry.call('telegram_video', { path: '/tmp/x.mp4' }, { db })).rejects.toThrow(
        /no chatId/,
      );
    } finally {
      if (prev === undefined) {
        delete process.env['TELEGRAM_BOT_TOKEN'];
      } else {
        process.env['TELEGRAM_BOT_TOKEN'] = prev;
      }
    }
  });
});
