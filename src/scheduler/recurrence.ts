/**
 * croner wrapper — parses cron expressions and computes `next_run_at` in
 * milliseconds UTC.
 *
 * Used as a PARSER ONLY (spec §26.4): callback-style `new Cron(expr, cb)`
 * is not used. The dispatcher owns wall-clock timing.
 */
import { Cron } from 'croner';

/** Result of a parse attempt. */
export type ParseResult = { ok: true; nextRunAt: number } | { ok: false; error: string };

/**
 * Parse `expr` (cron) and compute the next-run time after `after`.
 *
 * @param expr - The cron expression (5 or 6 fields).
 * @param timezone - IANA timezone, e.g. `Europe/Vienna`.
 * @param after - Reference timestamp (ms UTC). Defaults to `Date.now()`.
 * @returns The next run time in ms UTC, or a structured error.
 */
export function parseCron(expr: string, timezone: string, after?: number): ParseResult {
  try {
    const cron = new Cron(expr, { timezone });
    const next = cron.nextRun(after === undefined ? new Date() : new Date(after));
    if (!next) {
      return { ok: false, error: `cron "${expr}" produced no future occurrence` };
    }
    return { ok: true, nextRunAt: next.getTime() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parse a `when` spec: either an ISO 8601 timestamp (one-shot) or a cron
 * expression (recurring). Returns the next-run time + the kind.
 *
 * @param when - ISO 8601 string OR cron expression.
 * @param timezone - IANA timezone.
 * @returns `{ kind, nextRunAt }` on success; `{ error }` on parse failure.
 */
export function parseWhen(
  when: string,
  timezone: string,
):
  | { ok: true; kind: 'one_shot' | 'recurring'; nextRunAt: number; cronExpr: string | null }
  | { ok: false; error: string } {
  // ISO 8601 heuristic: starts with 4 digits + dash.
  if (/^\d{4}-\d{2}-\d{2}/.test(when)) {
    const t = Date.parse(when);
    if (!Number.isNaN(t)) {
      return { ok: true, kind: 'one_shot', nextRunAt: t, cronExpr: null };
    }
  }
  // Otherwise treat as cron.
  const cron = parseCron(when, timezone);
  if (!cron.ok) {
    return { ok: false, error: cron.error };
  }
  return { ok: true, kind: 'recurring', nextRunAt: cron.nextRunAt, cronExpr: when };
}
