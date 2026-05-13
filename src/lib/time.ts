/**
 * Time helpers — the project's "now" of record.
 *
 * Every repo INSERT used to inline `new Date().toISOString()`. Centralising
 * it gives one knob to swap in `vi.useFakeTimers()` or a clock-injection
 * port if/when deterministic time becomes necessary for tests beyond the
 * coverage vitest's fake timers already provide.
 */

/** UTC ISO-8601 timestamp for "now". The single source of truth in the codebase. */
export function nowIso(): string {
  return new Date().toISOString();
}
