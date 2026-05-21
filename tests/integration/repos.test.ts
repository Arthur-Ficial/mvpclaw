import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyMigrations,
  openDb,
  ChatsRepo,
  SessionsRepo,
  MessagesRepo,
  RunsRepo,
  OutboxRepo,
  type Db,
} from '../../src/db/index.js';

const MIGRATIONS = resolve(__dirname, '../../migrations');

/**
 * Build a fresh DB, migrated to the latest schema.
 */
function freshDb(tmp: string): Db {
  const db = openDb(join(tmp, 'mvpclaw.sqlite'));
  applyMigrations(db, MIGRATIONS);
  return db;
}

describe('repos — round-trip CRUD against a real SQLite database', () => {
  let tmp: string;
  let db: Db;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-repos-'));
    db = freshDb(tmp);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('chats: upsertChat dedupes on (provider, provider_chat_id, thread_id)', () => {
    const a = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '12345',
      type: 'private',
    });
    const b = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '12345',
      type: 'private',
    });
    expect(a.id).toBe(b.id);
    const all = ChatsRepo.listChats(db);
    expect(all).toHaveLength(1);
  });

  it('sessions: getOrCreateActiveSession returns the same row twice', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const s1 = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    const s2 = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    expect(s1.id).toBe(s2.id);
  });

  it('sessions: closeActiveSessions transitions active → closed', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const s1 = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    const closed = SessionsRepo.closeActiveSessions(db, chat.id);
    expect(closed).toBe(1);
    // A new call now returns a fresh session.
    const s2 = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    expect(s2.id).not.toBe(s1.id);
  });

  it('messages: provider_update_id dedup returns existing row', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const session = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    const first = MessagesRepo.insertMessage(db, {
      session_id: session.id,
      direction: 'inbound',
      provider: 'telegram',
      provider_update_id: 'tg-update-42',
      text: 'hello',
    });
    expect(first.inserted).toBe(true);
    const second = MessagesRepo.insertMessage(db, {
      session_id: session.id,
      direction: 'inbound',
      provider: 'telegram',
      provider_update_id: 'tg-update-42',
      text: 'hello',
    });
    expect(second.inserted).toBe(false);
    expect(second.row.id).toBe(first.row.id);
  });

  it('messages: recentMessages returns chronological order', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const session = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    for (let i = 0; i < 5; i++) {
      MessagesRepo.insertMessage(db, {
        session_id: session.id,
        direction: 'inbound',
        provider: 'telegram',
        provider_update_id: `tg-${i}`,
        text: `m${i}`,
      });
    }
    const rows = MessagesRepo.recentMessages(db, session.id, 3);
    expect(rows.map((r) => r.text)).toEqual(['m2', 'm3', 'm4']);
  });

  it('messages: messageStats counts received/sent + last activity per provider', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const session = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    MessagesRepo.insertMessage(db, {
      session_id: session.id,
      direction: 'inbound',
      provider: 'telegram',
      provider_update_id: 'in-1',
      text: 'hi',
    });
    MessagesRepo.insertMessage(db, {
      session_id: session.id,
      direction: 'inbound',
      provider: 'telegram',
      provider_update_id: 'in-2',
      text: 'again',
    });
    MessagesRepo.insertMessage(db, {
      session_id: session.id,
      direction: 'outbound',
      provider: 'telegram',
      provider_update_id: 'out-1',
      text: 'reply',
    });

    const all = MessagesRepo.messageStats(db);
    expect(all.total).toBe(3);
    expect(all.received).toBe(2);
    expect(all.sent).toBe(1);
    expect(all.lastAt).toMatch(/\d{4}-/);

    const tg = MessagesRepo.messageStats(db, 'telegram');
    expect(tg).toEqual(all);

    const none = MessagesRepo.messageStats(db, 'discord');
    expect(none).toEqual({ total: 0, received: 0, sent: 0, lastAt: null });
  });

  it('agent_runs: full lifecycle queued → running → succeeded', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const session = SessionsRepo.getOrCreateActiveSession(db, chat.id);
    const msg = MessagesRepo.insertMessage(db, {
      session_id: session.id,
      direction: 'inbound',
      provider: 'telegram',
      provider_update_id: 'tg-1',
      text: 'go',
    });
    const run = RunsRepo.createRun(db, {
      session_id: session.id,
      input_message_id: msg.row.id,
      provider: 'openrouter',
      trace_path: '/tmp/run.jsonl',
    });
    expect(run.status).toBe('queued');
    RunsRepo.markRunRunning(db, run.id);
    expect(RunsRepo.findRunById(db, run.id)?.status).toBe('running');
    RunsRepo.markRunSucceeded(db, run.id);
    expect(RunsRepo.findRunById(db, run.id)?.status).toBe('succeeded');
  });

  it('outbox: claim is atomic — only one caller wins', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const row = OutboxRepo.enqueueOutbox(db, {
      chat_id: chat.id,
      provider: 'telegram',
      provider_chat_id: '1',
      kind: 'text',
      text: 'hi',
    });
    expect(OutboxRepo.claimOutboxRow(db, row.id)).toBe(true);
    // A second claim must fail (row is now 'sending', not 'pending').
    expect(OutboxRepo.claimOutboxRow(db, row.id)).toBe(false);
  });

  it('outbox: state transitions pending → sending → sent', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    const row = OutboxRepo.enqueueOutbox(db, {
      chat_id: chat.id,
      provider: 'telegram',
      provider_chat_id: '1',
      kind: 'text',
      text: 'hi',
    });
    OutboxRepo.claimOutboxRow(db, row.id);
    OutboxRepo.markOutboxSent(db, row.id, 'tg-msg-7');
    const all = OutboxRepo.listOutbox(db);
    expect(all[0]?.status).toBe('sent');
    expect(all[0]?.provider_message_id).toBe('tg-msg-7');
    expect(all[0]?.attempts).toBe(1);
  });

  it('outbox: listOutbox filters by status', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'telegram',
      provider_chat_id: '1',
      type: 'private',
    });
    OutboxRepo.enqueueOutbox(db, {
      chat_id: chat.id,
      provider: 'telegram',
      provider_chat_id: '1',
      kind: 'text',
      text: 'a',
    });
    const sentRow = OutboxRepo.enqueueOutbox(db, {
      chat_id: chat.id,
      provider: 'telegram',
      provider_chat_id: '1',
      kind: 'text',
      text: 'b',
    });
    OutboxRepo.claimOutboxRow(db, sentRow.id);
    OutboxRepo.markOutboxSent(db, sentRow.id, null);

    const pending = OutboxRepo.listOutbox(db, { status: 'pending' });
    const sent = OutboxRepo.listOutbox(db, { status: 'sent' });
    expect(pending).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});
