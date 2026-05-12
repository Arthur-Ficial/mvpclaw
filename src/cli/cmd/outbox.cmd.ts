/**
 * `mvpclaw outbox` — observe and steer outgoing messages (list/tail/peek/flush/cancel).
 *
 * Full implementation arrives in ticket C5 (#29).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const outboxCmd = defineCommand({
  meta: {
    name: 'outbox',
    description: 'List / tail / peek / flush / cancel outgoing messages.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('outbox', 'C5 / #29'),
});
