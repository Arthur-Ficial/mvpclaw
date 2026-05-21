/**
 * `mvpclaw revive` — undo the killswitch and re-bootstrap the daemon.
 *
 * Two steps, in order:
 *   1. Delete `~/.mvpclaw/killswitch` if present (so the watchdog will work
 *      again and the daemon's `KeepAlive: true` is in charge again).
 *   2. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mvpclaw.daemon.plist`
 *      to put the job back into launchd if it was bootouted.
 *
 * Exits 0 on success, 3 if `launchctl bootstrap` failed (the daemon may be
 * already running, in which case bootstrap returns non-zero — we re-check
 * via `launchctl print` and treat "service exists" as success).
 */
import { defineCommand } from 'citty';
import { spawnSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { DAEMON_LABEL, disengageKillswitch } from '../../killswitch/index.js';
import { detectInit, startCommand } from '../../platform/index.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const reviveCmd = defineCommand({
  meta: {
    name: 'revive',
    description: 'Disengage the killswitch and bootstrap the MVPClaw daemon back into launchd.',
  },
  args: { ...commonArgs },
  async run({ args }): Promise<void> {
    const out = resolveOutputContext(args);
    const removed = disengageKillswitch();
    const plist = join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
    const uid = String(userInfo().uid);
    // OS-aware start: launchctl bootstrap (macOS) or `systemctl --user start` (Linux).
    const init = detectInit(process.platform);
    const start = startCommand(init, { label: DAEMON_LABEL, plistPath: plist, uid });
    const bootstrap = spawnSync(start.cmd, start.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    let alreadyLoaded = false;
    if (bootstrap.status !== 0) {
      // Non-zero may just mean "already running" — confirm via an is-active probe.
      const probe =
        init === 'launchd'
          ? spawnSync('/bin/launchctl', ['print', `gui/${uid}/${DAEMON_LABEL}`], {
              stdio: ['ignore', 'pipe', 'pipe'],
              encoding: 'utf8',
            })
          : spawnSync('systemctl', ['--user', 'is-active', `${DAEMON_LABEL}.service`], {
              stdio: ['ignore', 'pipe', 'pipe'],
              encoding: 'utf8',
            });
      alreadyLoaded = probe.status === 0;
    }
    const ok = bootstrap.status === 0 || alreadyLoaded;
    writeOut(
      {
        killswitchRemoved: removed,
        bootstrapped: bootstrap.status === 0,
        alreadyLoaded,
        ok,
        stderr: bootstrap.stderr?.trim() ?? '',
      },
      out,
    );
    if (!ok) {
      process.exit(3);
    }
  },
});
