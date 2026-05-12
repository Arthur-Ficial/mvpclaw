/**
 * `mvpclaw start` — boot the daemon (Telegram channel poller, scheduler tick, outbox worker).
 *
 * This is the "run the bot for real" verb that `pnpm dev` invokes. Full
 * implementation requires the channel adapters (P3 + C2), orchestrator (P4),
 * and scheduler (P11). Stub until then.
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const startCmd = defineCommand({
  meta: {
    name: 'start',
    description: 'Start the MVPClaw daemon (channel pollers + scheduler + outbox).',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('start', 'P4 / #10 (requires P3, C2, P4, P11)'),
});
