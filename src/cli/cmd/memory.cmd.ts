/**
 * `mvpclaw memory` — show / append / edit / clear / archive / grep agent memory.
 *
 * Full implementation arrives in ticket C9 (#33).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const memoryCmd = defineCommand({
  meta: {
    name: 'memory',
    description: 'Show / append / edit / clear / archive / grep runtime + per-chat memory.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('memory', 'C9 / #33'),
});
