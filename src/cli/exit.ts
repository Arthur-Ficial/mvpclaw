/**
 * Canonical exit-code helpers for every CLI sub-command.
 *
 * The Unix-style contract from `CLAUDE.md`:
 *
 *   0 — success
 *   1 — usage error (bad flag, missing required arg, malformed input)
 *   2 — config error (missing/invalid mvpclaw.config.json, missing env var)
 *   3 — runtime error (provider failure, DB error, unexpected exception)
 *   4 — not found (run id / task id / chat id / outbox id does not exist)
 *   5 — timeout (operation did not complete within the requested deadline)
 *
 * Each helper writes the message to STDERR (never stdout) and calls
 * `process.exit(code)`. Use these instead of throwing or calling
 * `process.exit()` directly so the exit-code convention stays uniform.
 */

/** Write a message to stderr with the canonical "mvpclaw: <msg>" prefix. */
function emit(prefix: string, msg: string): void {
  process.stderr.write(`mvpclaw: ${prefix}: ${msg}\n`);
}

/** Exit 1 — bad usage / missing argument / malformed CLI input. */
export function exitUsage(msg: string): never {
  emit('usage', msg);
  process.exit(1);
}

/** Exit 2 — config invalid, missing, or required env var unset. */
export function exitConfig(msg: string): never {
  emit('config', msg);
  process.exit(2);
}

/** Exit 3 — runtime failure that is not the user's fault. */
export function exitRuntime(msg: string): never {
  emit('runtime', msg);
  process.exit(3);
}

/** Exit 4 — referenced entity (run, task, chat, outbox row, file) was not found. */
export function exitNotFound(msg: string): never {
  emit('not-found', msg);
  process.exit(4);
}

/** Exit 5 — operation timed out before completing. */
export function exitTimeout(msg: string): never {
  emit('timeout', msg);
  process.exit(5);
}
