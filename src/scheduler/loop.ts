/**
 * Drift-corrected tick loop.
 *
 * Per spec §26.2: `expected_next = anchor + (n+1)*interval`. We schedule
 * each next tick with `setTimeout` based on the anchor + tick count, not
 * naive `setInterval` (which drifts cumulatively).
 *
 * Two timers per loop:
 *   - fast tick — every `tickMs` (default 1000), runs `onTick`.
 *   - sweep    — every `sweepMs` (default 60000), runs `onSweep`.
 *
 * `start()` returns a `stop()` function that flushes the in-flight timer
 * and resolves once it's clear.
 */

/** Configuration for `startTickLoop`. */
export interface TickLoopOptions {
  tickMs: number;
  sweepMs: number;
  onTick(): Promise<void> | void;
  onSweep(): Promise<void> | void;
  /** Inject a clock for tests. Returns ms since epoch. Default `Date.now`. */
  now?: () => number;
}

/** Handle returned by `startTickLoop`. */
export interface TickLoopHandle {
  /** Stop both timers. Resolves once any in-flight callback completes. */
  stop(): Promise<void>;
  /** Number of ticks fired so far. Exposed for tests. */
  readonly tickCount: () => number;
  /** Anchor timestamp the loop started at. */
  readonly anchor: number;
}

/**
 * Start a drift-corrected tick + sweep loop.
 *
 * @param opts - Cadence + callbacks.
 * @returns A handle whose `stop()` cleanly tears down the timers.
 */
export function startTickLoop(opts: TickLoopOptions): TickLoopHandle {
  const clock = opts.now ?? (() => Date.now());
  const anchor = clock();
  let ticks = 0;
  let sweeps = 0;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let tickTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;

  function scheduleNextTick(): void {
    if (stopped) {
      return;
    }
    const expected = anchor + (ticks + 1) * opts.tickMs;
    const delay = Math.max(0, expected - clock());
    tickTimer = setTimeout(() => {
      ticks++;
      const p = Promise.resolve(opts.onTick()).catch(() => undefined);
      inFlight = p;
      void p.finally(() => {
        if (inFlight === p) {
          inFlight = null;
        }
        scheduleNextTick();
      });
    }, delay);
  }

  function scheduleNextSweep(): void {
    if (stopped) {
      return;
    }
    const expected = anchor + (sweeps + 1) * opts.sweepMs;
    const delay = Math.max(0, expected - clock());
    sweepTimer = setTimeout(() => {
      sweeps++;
      const p = Promise.resolve(opts.onSweep()).catch(() => undefined);
      void p.finally(scheduleNextSweep);
    }, delay);
  }

  scheduleNextTick();
  scheduleNextSweep();

  return {
    anchor,
    tickCount: () => ticks,
    async stop(): Promise<void> {
      stopped = true;
      if (tickTimer !== null) {
        clearTimeout(tickTimer);
        tickTimer = null;
      }
      if (sweepTimer !== null) {
        clearTimeout(sweepTimer);
        sweepTimer = null;
      }
      if (inFlight !== null) {
        await inFlight;
      }
    },
  };
}
