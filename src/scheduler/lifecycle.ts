/**
 * Pure state-machine for the task lifecycle (spec §26.5).
 *
 * No side effects — just the legal transitions. The scheduler dispatcher
 * + the CLI consult this when deciding whether a request makes sense.
 */
import type { TaskState } from '../db/index.js';

/** Map of state → set of legal target states. */
const LEGAL_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = Object.freeze({
  scheduled: ['running', 'cancelled', 'paused'],
  running: ['scheduled', 'completed', 'failed', 'cancelled'],
  failed: ['scheduled', 'dead'],
  paused: ['scheduled', 'cancelled'],
  completed: [],
  dead: [],
  cancelled: [],
});

/** Is `to` a legal transition from `from`? */
export function canTransition(from: TaskState, to: TaskState): boolean {
  return (LEGAL_TRANSITIONS[from] as readonly TaskState[]).includes(to);
}

/** Is a state terminal (no further transitions)? */
export function isTerminal(state: TaskState): boolean {
  return state === 'completed' || state === 'dead' || state === 'cancelled';
}
