/**
 * `mvpclaw send` — inject a synthetic InboundMessage through a channel adapter.
 *
 * The killer command. Full implementation arrives in ticket C4 (#28).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const sendCmd = defineCommand({
  meta: {
    name: 'send',
    description: 'Inject a message via a channel adapter (the killer command).',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('send', 'C4 / #28'),
});
