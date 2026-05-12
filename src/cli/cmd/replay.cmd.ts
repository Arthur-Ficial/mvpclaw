/**
 * `mvpclaw replay` — re-run a stored agent run.
 *
 * Convenience alias for `mvpclaw agent replay <run-id>`. Full implementation
 * arrives with `agent` in ticket C6 (#30).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const replayCmd = defineCommand({
  meta: {
    name: 'replay',
    description: 'Re-run a stored agent run (alias for `agent replay`).',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('replay', 'C6 / #30'),
});
