/**
 * Graceful shutdown hook installation (spec §26.7).
 *
 * Re-entrant safe: a second SIGTERM during shutdown is ignored.
 */

/** Options for `installShutdownHandler`. */
export interface ShutdownOptions {
  /** Async function that does the actual cleanup (close DB, drain outbox, etc.). */
  drain(): Promise<void>;
  /** Max time to drain in ms. Default 15000. */
  drainMs?: number;
  /** Hard-kill fallback in ms. Default 30000. */
  hardMs?: number;
}

let installed = false;
let shuttingDown = false;

/**
 * Install SIGTERM + SIGINT handlers that call `drain()` and exit.
 *
 * @param opts - The drain callback + optional time budgets.
 */
export function installShutdownHandler(opts: ShutdownOptions): void {
  if (installed) {
    return;
  }
  installed = true;
  const drainMs = opts.drainMs ?? 15_000;
  const hardMs = opts.hardMs ?? 30_000;

  const handler = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stderr.write(`mvpclaw: shutdown: received ${signal}, draining…\n`);
    // Hard-kill fallback in case drain() hangs.
    const force = setTimeout(() => {
      process.stderr.write('mvpclaw: shutdown: drain timeout, force exit\n');
      process.exit(1);
    }, hardMs);
    force.unref();

    // Drain bounded by drainMs.
    const drainPromise = opts.drain();
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, drainMs));
    void Promise.race([drainPromise, timeoutPromise]).then(() => {
      clearTimeout(force);
      process.exit(0);
    });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

/** Test-only: reset the module's installed flag. */
export function _resetForTests(): void {
  installed = false;
  shuttingDown = false;
}
