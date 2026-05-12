/**
 * `mvpclaw trace` — list / show / tail / filter agent-run traces.
 *
 * Full implementation arrives in ticket C10 (#34).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const traceCmd = defineCommand({
  meta: {
    name: 'trace',
    description: 'List / show / tail / filter agent-run JSONL traces.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('trace', 'C10 / #34'),
});
