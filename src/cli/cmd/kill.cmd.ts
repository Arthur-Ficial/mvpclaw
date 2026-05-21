/**
 * `mvpclaw kill` — stop the daemon and keep it stopped (the inverse of
 * `mvpclaw revive`).
 *
 * Two effects, in order:
 *   1. Write the killswitch sentinel (`~/.mvpclaw/killswitch`) so the watchdog
 *      will NOT resurrect the daemon.
 *   2. `launchctl bootout` the daemon job so it stops now (its launchd
 *      KeepAlive cannot bring it back while the sentinel exists).
 *
 * A non-zero bootout just means the daemon was already stopped — still a
 * successful kill. Exits 0 when the killswitch is engaged; 3 only if the
 * sentinel could not be written. Restart later with `mvpclaw revive`.
 */
import { defineCommand } from 'citty';
import { killDaemon } from '../../killswitch/index.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const killCmd = defineCommand({
  meta: {
    name: 'kill',
    description:
      'Stop the daemon and keep it down (engage killswitch). Undo with `mvpclaw revive`.',
  },
  args: {
    ...commonArgs,
    reason: {
      type: 'string',
      description: 'Why the daemon is being killed (recorded in the sentinel).',
      default: 'manual stop via mvpclaw kill',
    },
  },
  run({ args }): void {
    const out = resolveOutputContext(args);
    const reason = typeof args.reason === 'string' ? args.reason : 'manual stop via mvpclaw kill';
    const result = killDaemon({ reason });
    writeOut(result, out);
    if (!result.ok) {
      process.stderr.write('mvpclaw: kill: failed to engage killswitch\n');
      process.exit(3);
    }
  },
});
