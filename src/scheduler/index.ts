/**
 * Scheduler area — drift-corrected tick + sweep + lifecycle state machine.
 *
 * Spec §26. The dispatcher (P12) sits on top of these primitives and
 * fans due tasks out to the orchestrator. P11 ships just the skeleton:
 *   - `startTickLoop` — pure timing (no DB calls)
 *   - `canTransition` — pure lifecycle state machine
 *   - `installShutdownHandler` — SIGTERM/SIGINT graceful drain
 */
export { startTickLoop } from './loop.js';
export type { TickLoopOptions, TickLoopHandle } from './loop.js';
export { canTransition, isTerminal } from './lifecycle.js';
export { installShutdownHandler } from './shutdown.js';
export type { ShutdownOptions } from './shutdown.js';
