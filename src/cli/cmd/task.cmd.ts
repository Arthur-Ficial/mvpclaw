/**
 * `mvpclaw task` — full scheduled-task lifecycle (schedule/list/show/cancel/pause/resume/run-now/update).
 *
 * Full implementation arrives in ticket C8 (#32).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const taskCmd = defineCommand({
  meta: {
    name: 'task',
    description: 'Schedule / list / show / cancel / pause / resume / run-now / update tasks.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('task', 'C8 / #32'),
});
