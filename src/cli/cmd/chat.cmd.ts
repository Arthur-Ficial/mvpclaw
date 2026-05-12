/**
 * `mvpclaw chat` — list / show / new / reset chats.
 *
 * Full implementation arrives in ticket C6 (#30).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const chatCmd = defineCommand({
  meta: {
    name: 'chat',
    description: 'List / show / new / reset chats.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('chat', 'C6 / #30'),
});
