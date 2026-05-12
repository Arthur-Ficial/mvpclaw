import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyMigrations, openDb, ChatsRepo, type Db } from '../../src/db/index.js';
import {
  evaluateProactive,
  recordProactiveSend,
  setChatBlocked,
  isInQuietHours,
} from '../../src/app/index.js';
import { ProactiveConfig } from '../../src/config/index.js';

const MIGRATIONS = resolve(__dirname, '../../migrations');

const defaults = ProactiveConfig.parse({});

describe('proactive policy — outbox gates', () => {
  let tmp: string;
  let db: Db;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-proactive-'));
    db = openDb(join(tmp, 'db.sqlite'));
    applyMigrations(db, MIGRATIONS);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  function mkChat(): string {
    const c = ChatsRepo.upsertChat(db, {
      provider: 'cli-inject',
      provider_chat_id: 'c-1',
      type: 'private',
    });
    return c.id;
  }

  it('allowed on a fresh chat outside quiet hours', () => {
    const id = mkChat();
    // 2024-01-01 13:00 UTC → 14:00 Vienna (winter), outside quiet window.
    const now = Date.UTC(2024, 0, 1, 13, 0, 0);
    const d = evaluateProactive(db, id, defaults, now, 'Europe/Vienna');
    expect(d).toEqual({ allowed: true });
  });

  it('blocks when chat_blocked is set', () => {
    const id = mkChat();
    setChatBlocked(db, id, 1);
    const now = Date.UTC(2024, 0, 1, 13, 0, 0);
    const d = evaluateProactive(db, id, defaults, now, 'Europe/Vienna');
    expect(d).toEqual({ allowed: false, reason: 'chat_blocked' });
  });

  it('blocks during quiet hours (wrap-around)', () => {
    const id = mkChat();
    // 03:00 Vienna → middle of default 22:00..08:00 window.
    const now = Date.UTC(2024, 0, 1, 2, 0, 0);
    const d = evaluateProactive(db, id, defaults, now, 'Europe/Vienna');
    expect(d.allowed).toBe(false);
    expect(d.allowed || (d as { reason: string }).reason).toBe('quiet_hours');
  });

  it('blocks at the daily cap', () => {
    const id = mkChat();
    const now = Date.UTC(2024, 0, 1, 13, 0, 0);
    const cfg = { ...defaults, maxPerChatPerDay: 2, minGapSeconds: 0 };
    expect(evaluateProactive(db, id, cfg, now, 'Europe/Vienna').allowed).toBe(true);
    recordProactiveSend(db, id, now, 'Europe/Vienna');
    expect(evaluateProactive(db, id, cfg, now + 1000, 'Europe/Vienna').allowed).toBe(true);
    recordProactiveSend(db, id, now + 1000, 'Europe/Vienna');
    const blocked = evaluateProactive(db, id, cfg, now + 2000, 'Europe/Vienna');
    expect(blocked.allowed).toBe(false);
    expect((blocked as { reason: string }).reason).toBe('daily_cap');
  });

  it('resets the counter when the local-day rolls over', () => {
    const id = mkChat();
    const day1 = Date.UTC(2024, 0, 1, 13, 0, 0);
    const day2 = Date.UTC(2024, 0, 2, 13, 0, 0);
    const cfg = { ...defaults, maxPerChatPerDay: 1, minGapSeconds: 0 };
    recordProactiveSend(db, id, day1, 'Europe/Vienna');
    expect(evaluateProactive(db, id, cfg, day1 + 1000, 'Europe/Vienna').allowed).toBe(false);
    expect(evaluateProactive(db, id, cfg, day2, 'Europe/Vienna').allowed).toBe(true);
  });

  it('blocks within the min-gap window', () => {
    const id = mkChat();
    const now = Date.UTC(2024, 0, 1, 13, 0, 0);
    const cfg = { ...defaults, minGapSeconds: 600 };
    recordProactiveSend(db, id, now, 'Europe/Vienna');
    const blocked = evaluateProactive(db, id, cfg, now + 300_000, 'Europe/Vienna');
    expect(blocked.allowed).toBe(false);
    expect((blocked as { reason: string }).reason).toBe('min_gap');
    const ok = evaluateProactive(db, id, cfg, now + 700_000, 'Europe/Vienna');
    expect(ok.allowed).toBe(true);
  });
});

describe('isInQuietHours — wrap-around math', () => {
  it('22:00–08:00 includes 03:00 and excludes 09:00 (Vienna)', () => {
    const t0300 = Date.UTC(2024, 0, 1, 2, 0, 0); // 03:00 Vienna winter
    const t0900 = Date.UTC(2024, 0, 1, 8, 0, 0); // 09:00 Vienna winter
    expect(isInQuietHours(t0300, 'Europe/Vienna', '22:00', '08:00')).toBe(true);
    expect(isInQuietHours(t0900, 'Europe/Vienna', '22:00', '08:00')).toBe(false);
  });

  it('09:00–17:00 includes 13:00 and excludes 18:00 (no wrap)', () => {
    const t1300 = Date.UTC(2024, 0, 1, 12, 0, 0); // 13:00 Vienna winter
    const t1800 = Date.UTC(2024, 0, 1, 17, 0, 0); // 18:00 Vienna winter
    expect(isInQuietHours(t1300, 'Europe/Vienna', '09:00', '17:00')).toBe(true);
    expect(isInQuietHours(t1800, 'Europe/Vienna', '09:00', '17:00')).toBe(false);
  });
});
