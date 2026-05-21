/**
 * Link-aware routing tests — linked identities (e.g. owner Telegram + email)
 * resolve to ONE shared session; unlinked senders stay isolated. Real
 * in-memory SQLite + migrations, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, openDb, type Db } from '../../src/db/index.js';
import { routeInbound } from '../../src/app/inbound-router.js';
import type { InboundMessage } from '../../src/channels/index.js';
import type { LinkGroup } from '../../src/config/index.js';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

const LINKS: LinkGroup[] = [
  {
    id: 'owner',
    primary: { channel: 'telegram', id: '111' },
    members: [
      { channel: 'telegram', id: '111' },
      { channel: 'email', id: 'me@example.com' },
    ],
  },
];

function tgMsg(text: string): InboundMessage {
  return {
    id: 'telegram:' + Math.random(),
    channel: 'telegram',
    providerUpdateId: 'tg-' + Math.random(),
    providerChatId: '111',
    providerUserId: 'u1',
    text,
    receivedAt: new Date().toISOString(),
  };
}
function emailMsg(from: string, text: string): InboundMessage {
  return {
    id: 'email:' + Math.random(),
    channel: 'email',
    providerUpdateId: '<' + Math.random() + '@example.com>',
    providerChatId: from,
    providerUserId: from,
    text,
    receivedAt: new Date().toISOString(),
  };
}

let tmp: string;
let db: Db;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-links-'));
  db = openDb(join(tmp, 'd.sqlite'));
  applyMigrations(db, MIGRATIONS);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('routeInbound — channel links', () => {
  it('a linked email + linked telegram share ONE session; resolved.chat is the primary', () => {
    const tg = routeInbound(db, tgMsg('from telegram'), undefined, LINKS);
    const em = routeInbound(db, emailMsg('me@example.com', 'from email'), undefined, LINKS);

    expect(em.session.id).toBe(tg.session.id); // same shared session
    expect(em.chat.provider).toBe('telegram'); // resolved.chat is the primary
    expect(em.chat.provider_chat_id).toBe('111');
    // the stored inbound message keeps its real provider.
    expect(em.message.provider).toBe('email');
  });

  it('an UNLINKED sender gets its own separate session', () => {
    const tg = routeInbound(db, tgMsg('hi'), undefined, LINKS);
    const stranger = routeInbound(db, emailMsg('stranger@x.com', 'spam?'), undefined, LINKS);
    expect(stranger.session.id).not.toBe(tg.session.id);
    expect(stranger.chat.provider).toBe('email');
  });

  it('with no links, every chat keeps its own session (back-compat)', () => {
    const a = routeInbound(db, tgMsg('a'));
    const b = routeInbound(db, emailMsg('me@example.com', 'b'));
    expect(a.session.id).not.toBe(b.session.id);
  });

  it('/new on the linked email resets the shared (primary) session', () => {
    const tg = routeInbound(db, tgMsg('hello'), undefined, LINKS);
    const reset = routeInbound(db, emailMsg('me@example.com', '/new'), undefined, LINKS);
    expect(reset.isHandledCommand).toBe(true);
    // a subsequent telegram message lands in a NEW session (old one closed).
    const after = routeInbound(db, tgMsg('next'), undefined, LINKS);
    expect(after.session.id).not.toBe(tg.session.id);
  });
});
