/**
 * `mvpclaw skill` — list / show / validate / sync / invoke AgentSkills.
 *
 * Full implementation arrives in ticket C9 (#33).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const skillCmd = defineCommand({
  meta: {
    name: 'skill',
    description: 'List / show / validate / sync / invoke AgentSkills.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('skill', 'C9 / #33'),
});
