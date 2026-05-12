/**
 * Canonical stdout writer for CLI sub-commands.
 *
 * Rules (from `CLAUDE.md` / `ARCHITECTURE.md` §1bis):
 *
 *   - stdout = data only. Never logs, never progress messages.
 *   - stderr = logs / progress / errors.
 *   - `--json` flag forces JSON output. Without it, output is JSON when
 *     STDOUT is not a TTY (so pipes always get parseable data) and a
 *     pretty table/text form when running in a terminal.
 *
 * Every sub-command's handler receives a resolved `OutputContext` and writes
 * its result via `writeOut(value, ctx)` — no sub-command writes to stdout
 * directly.
 */

/**
 * Resolved output settings for a single command invocation.
 *
 * Built once at the top of every command handler from the parsed flags +
 * `process.stdout.isTTY` and passed down.
 */
export interface OutputContext {
  /** When true, force JSON output regardless of TTY state. */
  json: boolean;
  /** When true, suppress non-error output (data still goes through). */
  quiet: boolean;
  /** When true, emit structured progress to STDERR (not stdout). */
  verbose: boolean;
}

/**
 * Resolve output settings from raw flag values and the runtime environment.
 *
 * @param flags - The CLI flags parsed by citty (`--json`, `--quiet`, `--verbose`).
 * @returns A resolved `OutputContext`. `json` is forced true when STDOUT is
 *          not a TTY (pipe / file redirect / non-interactive shell).
 */
export function resolveOutputContext(flags: {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}): OutputContext {
  const isTTY = process.stdout.isTTY === true;
  return {
    json: flags.json === true || !isTTY,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
  };
}

/**
 * Write a single value to STDOUT as the command's "result".
 *
 * - JSON mode → `JSON.stringify(value) + '\n'`.
 * - Human mode → a best-effort pretty print:
 *     * strings → as-is + newline
 *     * arrays of objects → tabular (aligned columns), if all rows share the same keys
 *     * other → JSON.stringify with 2-space indent
 *
 * @param value - The data to emit. Must be JSON-serializable.
 * @param ctx - The resolved output context (controls JSON vs human format).
 */
export function writeOut(value: unknown, ctx: OutputContext): void {
  if (ctx.quiet) {
    return;
  }
  if (ctx.json) {
    process.stdout.write(JSON.stringify(value) + '\n');
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(value + (value.endsWith('\n') ? '' : '\n'));
    return;
  }
  if (Array.isArray(value) && value.length > 0 && allShareKeys(value)) {
    process.stdout.write(formatTable(value as Array<Record<string, unknown>>));
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/**
 * Emit a single line of JSON to STDOUT — used by `tail --follow` streams.
 *
 * @param value - The data to emit. Always serialized as JSON regardless of TTY.
 */
export function writeJsonLine(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}

/**
 * Emit a structured progress note to STDERR.
 *
 * Only writes when `ctx.verbose` is true. Never goes to stdout.
 *
 * @param msg - The progress message.
 * @param ctx - The resolved output context.
 */
export function writeProgress(msg: string, ctx: OutputContext): void {
  if (!ctx.verbose) {
    return;
  }
  process.stderr.write(`mvpclaw: progress: ${msg}\n`);
}

/** True iff `arr` is non-empty and every element is an object with the same keys. */
function allShareKeys(arr: unknown[]): boolean {
  if (arr.length === 0) {
    return false;
  }
  const first = arr[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    return false;
  }
  const expected = Object.keys(first as Record<string, unknown>)
    .sort()
    .join(',');
  for (const row of arr) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return false;
    }
    if (
      Object.keys(row as Record<string, unknown>)
        .sort()
        .join(',') !== expected
    ) {
      return false;
    }
  }
  return true;
}

/** Format an array of homogeneous row objects as an aligned text table. */
function formatTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }
  const firstRow = rows[0];
  if (firstRow === undefined) {
    return '';
  }
  const cols = Object.keys(firstRow);
  const widths: Record<string, number> = {};
  for (const c of cols) {
    widths[c] = c.length;
  }
  const cells = rows.map((row) => {
    const r: Record<string, string> = {};
    for (const c of cols) {
      const v = row[c];
      r[c] = v === null || v === undefined ? '' : String(v);
      const w = widths[c] ?? 0;
      if (r[c].length > w) {
        widths[c] = r[c].length;
      }
    }
    return r;
  });
  const fmtRow = (r: Record<string, string>): string =>
    cols.map((c) => (r[c] ?? '').padEnd(widths[c] ?? 0)).join('  ');
  const header = cols.map((c) => c.padEnd(widths[c] ?? 0)).join('  ');
  const sep = cols.map((c) => '-'.repeat(widths[c] ?? 0)).join('  ');
  return [header, sep, ...cells.map(fmtRow)].join('\n') + '\n';
}
