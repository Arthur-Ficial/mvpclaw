/**
 * `mvpclaw agent` — direct agent runs (run / replay / dry-run), bypassing channel + outbox.
 *
 * Full implementation arrives in ticket C6 (#30).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const agentCmd = defineCommand({
  meta: {
    name: 'agent',
    description: 'Direct agent runs (run / replay / dry-run); bypasses channel and outbox.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('agent', 'C6 / #30'),
});
