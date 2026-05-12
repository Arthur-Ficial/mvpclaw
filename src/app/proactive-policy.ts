/**
 * Proactive-send policy (spec §33).
 *
 * Used by the outbox worker BEFORE it calls `channel.send()` on rows whose
 * `run_id` is `null` (i.e. scheduler-originated, not reply-to-user). Four
 * gates, evaluated in order:
 *
 *   1. `chat_blocked`  — Telegram 403 set this; never send.
 *   2. Quiet hours    — local-tz `HH:mm` window; defer to start-of-day.
 *   3. Daily cap      — `proactive_count_today` ≥ `maxPerChatPerDay`.
 *   4. Min-gap        — `last_proactive_send` newer than `now - minGapSeconds`.
 *
 * On success the policy updates the counters atomically.
 *
 * The gates only apply to **proactive** rows. Replies to a user (rows with a
 * non-null `run_id`) bypass every gate — the user explicitly asked.
 */
import type { ProactiveConfig } from '../config/index.js';
import type { Db } from '../db/index.js';

/** Reason a proactive send was blocked (or `null` when allowed). */
export type ProactiveDecision =
  | { allowed: true }
  | { allowed: false; reason: 'chat_blocked' | 'quiet_hours' | 'daily_cap' | 'min_gap' };

interface ChatProactiveRow {
  id: string;
  chat_blocked: number;
  last_proactive_send: number | null;
  proactive_count_today: number;
  proactive_count_date: string | null;
}

/**
 * Decide whether a proactive send to `chat_id` is allowed right now.
 * Does NOT mutate the DB; call `recordProactiveSend` after a successful send.
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @param config - Proactive policy config (quiet hours, cap, gap).
 * @param now - Current epoch ms (injectable for tests).
 * @param timezone - IANA tz used for quiet-hours + daily-count calendar day.
 * @returns A decision; when `allowed = false`, also a reason string.
 */
export function evaluateProactive(
  db: Db,
  chat_id: string,
  config: ProactiveConfig,
  now: number,
  timezone: string,
): ProactiveDecision {
  const row = db
    .prepare(
      'SELECT id, chat_blocked, last_proactive_send, proactive_count_today, proactive_count_date FROM chats WHERE id = ?',
    )
    .get(chat_id) as ChatProactiveRow | undefined;
  if (!row) {
    return { allowed: true };
  }
  if (row.chat_blocked === 1) {
    return { allowed: false, reason: 'chat_blocked' };
  }
  if (isInQuietHours(now, timezone, config.quietHours.start, config.quietHours.end)) {
    return { allowed: false, reason: 'quiet_hours' };
  }
  const today = localDateString(now, timezone);
  const todayCount = row.proactive_count_date === today ? row.proactive_count_today : 0;
  if (todayCount >= config.maxPerChatPerDay) {
    return { allowed: false, reason: 'daily_cap' };
  }
  if (
    row.last_proactive_send !== null &&
    now - row.last_proactive_send < config.minGapSeconds * 1000
  ) {
    return { allowed: false, reason: 'min_gap' };
  }
  return { allowed: true };
}

/**
 * Record a successful proactive send: bumps the counter + last-send stamp.
 * Resets the counter when the date has rolled over.
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @param now - Current epoch ms.
 * @param timezone - IANA tz used to compute the calendar day.
 */
export function recordProactiveSend(db: Db, chat_id: string, now: number, timezone: string): void {
  const today = localDateString(now, timezone);
  const row = db
    .prepare('SELECT proactive_count_today, proactive_count_date FROM chats WHERE id = ?')
    .get(chat_id) as
    | { proactive_count_today: number; proactive_count_date: string | null }
    | undefined;
  const sameDay = row?.proactive_count_date === today;
  const newCount = sameDay ? (row?.proactive_count_today ?? 0) + 1 : 1;
  db.prepare(
    'UPDATE chats SET last_proactive_send = ?, proactive_count_today = ?, proactive_count_date = ?, updated_at = ? WHERE id = ?',
  ).run(now, newCount, today, new Date(now).toISOString(), chat_id);
}

/**
 * Set the `chat_blocked` flag on a chat. Used by the outbox worker when a
 * channel reports a permanent 403 ("user blocked the bot" on Telegram).
 *
 * @param db - Open SQLite handle.
 * @param chat_id - Internal chat id.
 * @param blocked - 1 to mark blocked, 0 to clear.
 */
export function setChatBlocked(db: Db, chat_id: string, blocked: 0 | 1): void {
  db.prepare('UPDATE chats SET chat_blocked = ?, updated_at = ? WHERE id = ?').run(
    blocked,
    new Date().toISOString(),
    chat_id,
  );
}

/**
 * Whether `now` falls within `[startHHMM, endHHMM)` interpreted in `timezone`.
 * Handles wrap-around (e.g., `22:00` → `08:00`).
 *
 * @param now - Epoch ms.
 * @param timezone - IANA timezone string.
 * @param startHHMM - Start of the quiet window, `HH:mm`.
 * @param endHHMM - End of the quiet window, `HH:mm`.
 * @returns True if the local time at `now` is inside the window.
 */
export function isInQuietHours(
  now: number,
  timezone: string,
  startHHMM: string,
  endHHMM: string,
): boolean {
  const localMinutes = localMinuteOfDay(now, timezone);
  const startMin = parseHHMM(startHHMM);
  const endMin = parseHHMM(endHHMM);
  if (startMin === endMin) {
    return false;
  }
  if (startMin < endMin) {
    return localMinutes >= startMin && localMinutes < endMin;
  }
  // Wrap-around: 22:00..08:00.
  return localMinutes >= startMin || localMinutes < endMin;
}

function parseHHMM(value: string): number {
  const [hh = '0', mm = '0'] = value.split(':');
  return Number(hh) * 60 + Number(mm);
}

function localMinuteOfDay(now: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
}

function localDateString(now: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}
