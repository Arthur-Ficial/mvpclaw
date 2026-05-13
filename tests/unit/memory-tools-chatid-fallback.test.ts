/**
 * Pins the `chat_id` fallback behaviour on `memory_read` + `memory_append`.
 *
 * Shipped in commit 213a865 (T-003). Without this fallback, the bot — which
 * only sees its EXTERNAL Telegram chat id, not the internal ULID — couldn't
 * persist anything to per-chat memory, because the schema is keyed on
 * internal id. Three turns failed before the fix.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, applyMigrations } from '../../src/db/index.js';
import { registerMemoryTools } from '../../src/memory/memory-tools.js';
import { createToolRegistry } from '../../src/tools/index.js';

function freshRegistry(): {
  db: ReturnType<typeof openDb>;
  registry: ReturnType<typeof createToolRegistry>;
} {
  const db = openDb(':memory:');
  applyMigrations(db, resolve(__dirname, '../../migrations'));
  db.exec(`INSERT INTO chats (id, provider, provider_chat_id, type, created_at, updated_at)
           VALUES ('chat-x', 'telegram', '1234567890', 'private', '2026-01-01', '2026-01-01')`);
  const registry = createToolRegistry();
  registerMemoryTools(registry, { redactEnvNames: [] });
  return { db, registry };
}

describe('memory_append / memory_read — chat_id fallback', () => {
  it('memory_append falls back to ctx.chatId when input.chat_id is omitted', async () => {
    const { db, registry } = freshRegistry();
    const result = await registry.call(
      'memory_append',
      { scope: 'chat', text: 'remember this' },
      { db, chatId: 'chat-x' },
    );
    expect((result as { scope: string }).scope).toBe('chat');
    const row = db.prepare('SELECT body FROM chat_memory WHERE chat_id = ?').get('chat-x') as
      | { body: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.body).toContain('remember this');
  });

  it('memory_append explicit input.chat_id wins over ctx.chatId', async () => {
    const { db, registry } = freshRegistry();
    db.exec(`INSERT INTO chats (id, provider, provider_chat_id, type, created_at, updated_at)
             VALUES ('chat-other', 'telegram', '999', 'private', '2026-01-01', '2026-01-01')`);
    await registry.call(
      'memory_append',
      { scope: 'chat', text: 'targeted', chat_id: 'chat-other' },
      { db, chatId: 'chat-x' },
    );
    const x = db.prepare('SELECT body FROM chat_memory WHERE chat_id = ?').get('chat-x');
    const other = db
      .prepare('SELECT body FROM chat_memory WHERE chat_id = ?')
      .get('chat-other') as { body: string };
    expect(x).toBeUndefined();
    expect(other.body).toContain('targeted');
  });

  it('memory_append throws when scope=chat and neither input.chat_id nor ctx.chatId is set', async () => {
    const { db, registry } = freshRegistry();
    await expect(
      registry.call('memory_append', { scope: 'chat', text: 'orphan' }, { db }),
    ).rejects.toThrow(/no chat_id given/);
  });

  it('memory_read falls back to ctx.chatId when input.chat_id is omitted', async () => {
    const { db, registry } = freshRegistry();
    await registry.call(
      'memory_append',
      { scope: 'chat', text: 'persistent note' },
      { db, chatId: 'chat-x' },
    );
    const result = await registry.call('memory_read', { scope: 'chat' }, { db, chatId: 'chat-x' });
    expect((result as { body: string }).body).toContain('persistent note');
  });

  it('memory_read throws when scope=chat and no chat context is provided', async () => {
    const { db, registry } = freshRegistry();
    await expect(registry.call('memory_read', { scope: 'chat' }, { db })).rejects.toThrow(
      /no chat_id given/,
    );
  });
});
