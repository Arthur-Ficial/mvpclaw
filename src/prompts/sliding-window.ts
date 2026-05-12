/**
 * Sliding-window truncation (spec §27).
 *
 * Given chronological history and limits, drop the oldest messages until
 * BOTH constraints hold:
 *   - count ≤ `windowMessages`
 *   - approximate token count ≤ `windowTokens` (chars/4 heuristic)
 *
 * Pure function; no DB, no logger. The orchestrator calls this before
 * passing history to the composer.
 */
import type { ChatMessage } from '../agent/index.js';

/** Limits a sliding window respects. */
export interface WindowLimits {
  windowMessages: number;
  windowTokens: number;
}

/** Result of `truncateHistory`. */
export interface TruncateResult {
  /** History after truncation, chronological. */
  history: readonly ChatMessage[];
  /** How many messages were dropped from the head. */
  dropped: number;
  /** Approximate tokens after truncation. */
  approxTokens: number;
}

const CHARS_PER_TOKEN = 4;

/**
 * Drop oldest messages until both window limits are satisfied.
 *
 * @param history - Chronological history (oldest first).
 * @param limits - Per-config caps.
 * @returns The truncated history + stats.
 */
export function truncateHistory(
  history: readonly ChatMessage[],
  limits: WindowLimits,
): TruncateResult {
  let working = history.slice();
  let totalChars = working.reduce((acc, m) => acc + m.content.length, 0);
  let dropped = 0;
  while (
    working.length > limits.windowMessages ||
    totalChars / CHARS_PER_TOKEN > limits.windowTokens
  ) {
    const head = working.shift();
    if (!head) {
      break;
    }
    totalChars -= head.content.length;
    dropped++;
  }
  return {
    history: working,
    dropped,
    approxTokens: Math.ceil(totalChars / CHARS_PER_TOKEN),
  };
}
