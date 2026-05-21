/**
 * send_message tool — lets the agent reply on a LINKED channel of the current
 * thread (e.g. answer a Telegram turn by sending an email). Only linked members
 * are reachable. Real in-memory SQLite, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, openDb, OutboxRepo, type Db } from '../../src/db/index.js';
import { sendMessageTool } from '../../src/tools/builtins.js';
import { MvpClawConfig } from '../../src/config/index.js';

const config = MvpClawConfig.parse({
  links: [
    {
      id: 'owner',
      primary: { channel: 'telegram', id: '111' },
      members: [
        { channel: 'telegram', id: '111' },
        { channel: 'email', id: 'me@example.com' },
      ],
    },
  ],
});

let tmp: string;
let db: Db;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-sm-'));
  db = openDb(join(tmp, 'd.sqlite'));
  applyMigrations(db, new URL('../../migrations', import.meta.url).pathname);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('send_message tool', () => {
  it('enqueues an outbox row on a linked channel (telegram turn → email reply)', async () => {
    const tool = sendMessageTool(config);
    const res = (await tool.execute(
      { channel: 'email', text: 'replying by email' },
      {
        db,
        channel: 'telegram',
        providerChatId: '111',
      },
    )) as { ok: boolean; channel: string; providerChatId: string };

    expect(res).toMatchObject({ ok: true, channel: 'email', providerChatId: 'me@example.com' });
    const rows = OutboxRepo.listOutbox(db, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'email', provider_chat_id: 'me@example.com' });
    expect(rows[0]?.text).toBe('replying by email');
  });

  it('rejects a channel that is not linked to this thread', async () => {
    const tool = sendMessageTool(config);
    await expect(
      tool.execute(
        { channel: 'discord', text: 'nope' },
        {
          db,
          channel: 'telegram',
          providerChatId: '111',
        },
      ),
    ).rejects.toThrow(/not linked/i);
    expect(OutboxRepo.listOutbox(db, {})).toHaveLength(0);
  });

  it('rejects when the current chat is not in any link group', async () => {
    const tool = sendMessageTool(config);
    await expect(
      tool.execute(
        { channel: 'email', text: 'x' },
        {
          db,
          channel: 'telegram',
          providerChatId: '999',
        },
      ),
    ).rejects.toThrow(/not in any link group/i);
  });
});
