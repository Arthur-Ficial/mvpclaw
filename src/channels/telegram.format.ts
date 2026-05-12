/**
 * Telegram text-formatting helpers.
 *
 * Pure functions, no I/O. Imported by `telegram.channel.ts` and exercised
 * directly by `tests/unit/telegram_format.test.ts`.
 *
 * The main job is `chunkText`: split a long string so each chunk fits
 * under Telegram's `maxMessageChars` (default 3900 per the spec, well
 * under the 4096 API hard limit), with three rules:
 *
 *   1. The fence-delimiter line (three backticks plus optional language
 *      tag) is ATOMIC. A chunk boundary never bisects it.
 *   2. When a chunk would close in the middle of a fenced block, append
 *      a closing fence to that chunk and start the next chunk with the
 *      matching opener (same language tag).
 *   3. Within a non-fenced region, prefer line boundaries over hard cuts.
 *      A single line longer than `maxChars` is hard-split at the last
 *      whitespace within the limit (or at `maxChars` if no whitespace).
 *
 * The algorithm is line-based: walk the source one line at a time,
 * tracking whether we're inside an open fence. This keeps the fence
 * invariant trivial to maintain.
 */

/** A fenced code-block opener: three backticks optionally followed by a language. */
const FENCE_RE = /^```([a-zA-Z0-9_+-]*)\s*$/;

/**
 * Hard-cut a line that on its own exceeds `maxChars`. Returns a list of
 * pieces each ≤ `maxChars`. Prefers a trailing-space boundary.
 *
 * @param line - The over-long line (no embedded newlines).
 * @param maxChars - The chunk size limit.
 * @returns Ordered pieces; concatenation equals `line`.
 */
function hardSplitLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }
  const pieces: string[] = [];
  let i = 0;
  while (i < line.length) {
    let end = Math.min(i + maxChars, line.length);
    if (end < line.length) {
      const space = line.lastIndexOf(' ', end - 1);
      if (space > i) {
        end = space + 1;
      }
    }
    pieces.push(line.slice(i, end));
    i = end;
  }
  return pieces;
}

/**
 * Split `text` into chunks each ≤ `maxChars`, preserving code-fence integrity.
 *
 * @param text - The full message text.
 * @param maxChars - Maximum chunk size in characters. Default per spec: 3900.
 * @returns An ordered list of chunks; each chunk is independently
 *          well-formed Markdown (no orphaned fences).
 *
 * @example
 * ```ts
 * for (const part of chunkText(longString, 3900)) {
 *   await bot.api.sendMessage(chatId, part);
 * }
 * ```
 */
export function chunkText(text: string, maxChars = 3900): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const lines = text.split('\n');
  const chunks: string[] = [];

  // The chunk currently being built.
  let current = '';
  // Open fence's language tag, or null when outside any fence.
  let openLang: string | null = null;
  // Reserve room for "\n```" when we're inside a fence so the close fits.
  const fenceReserve = 5;

  /** Close the current chunk (with fence-close if needed) and start the next. */
  function flush(): void {
    let head = current;
    let nextSeed = '';
    if (openLang !== null) {
      head = head + (head.endsWith('\n') ? '' : '\n') + '```';
      nextSeed = '```' + openLang;
    }
    chunks.push(head);
    current = nextSeed;
  }

  /** Append `line` as a new line of `current`, flushing if it would overflow. */
  function appendLine(line: string): void {
    // Hard-split lines longer than maxChars before considering them.
    const pieces = hardSplitLine(line, Math.max(1, maxChars - fenceReserve));
    for (const piece of pieces) {
      const sep = current.length === 0 ? '' : '\n';
      const candidate = current + sep + piece;
      const overshoot = openLang !== null ? fenceReserve : 0;
      if (candidate.length + overshoot > maxChars && current.length > 0) {
        flush();
        current = current.length === 0 ? piece : current + '\n' + piece;
      } else {
        current = candidate;
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fenceMatch = FENCE_RE.exec(line.trim());

    if (fenceMatch && openLang === null) {
      // Opening a fence: the delimiter line is atomic.
      appendLine(line);
      openLang = fenceMatch[1] ?? '';
      continue;
    }
    if (fenceMatch && openLang !== null) {
      // Closing the current fence.
      appendLine(line);
      openLang = null;
      continue;
    }

    appendLine(line);
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
