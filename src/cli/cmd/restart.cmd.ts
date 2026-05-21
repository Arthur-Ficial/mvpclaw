/**
 * `mvpclaw restart` — atomically restart the running daemon (cross-platform).
 *
 * launchd `kickstart -k` (macOS) / `systemctl --user restart` (Linux) both
 * SIGKILL the old process and respawn it from the supervisor's side, so this
 * works even when the bot restarts ITSELF (the calling `bash_exec` dies
 * mid-command but the supervisor respawns regardless). Does NOT touch the
 * killswitch — use `mvpclaw kill` / `mvpclaw revive` for stay-down / bring-back.
 *
 * Exits 0 when the restart command succeeds; 3 otherwise.
 */
import { defineCommand } from 'citty';
import { spawnSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { DAEMON_LABEL } from '../../killswitch/index.js';
import { detectInit, restartCommand } from '../../platform/index.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const restartCmd = defineCommand({
  meta: {
    name: 'restart',
    description: 'Atomically restart the daemon (launchd kickstart / systemd restart).',
  },
  args: { ...commonArgs },
  run({ args }): void {
    const out = resolveOutputContext(args);
    const plist = join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
    const uid = String(userInfo().uid);
    const init = detectInit(process.platform);
    const cmd = restartCommand(init, { label: DAEMON_LABEL, plistPath: plist, uid });
    const r = spawnSync(cmd.cmd, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    const ok = r.status === 0;
    writeOut({ ok, init, stderr: (r.stderr ?? '').trim() }, out);
    if (!ok) {
      process.stderr.write('mvpclaw: restart failed\n');
      process.exit(3);
    }
  },
});
