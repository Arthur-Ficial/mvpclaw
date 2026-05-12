/**
 * `mvpclaw tool` — direct ToolRegistry access (list / describe / call).
 *
 * Full implementation arrives in ticket C7 (#31).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const toolCmd = defineCommand({
  meta: {
    name: 'tool',
    description: 'List / describe / call any registered tool directly.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('tool', 'C7 / #31'),
});
