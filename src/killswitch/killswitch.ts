/**
 * Killswitch — permanent (until manually revived) shutdown of the daemon.
 *
 * The killswitch is a sentinel file at `~/.mvpclaw/killswitch`. While it
 * exists, the external watchdog (`scripts/watchdog.sh` driven by the
 * `com.mvpclaw.watchdog.plist` launchd job) refuses to restart the daemon.
 * This is the ONE escape hatch from MVPClaw's "always running" supervision
 * — every other shutdown path is, by design, immediately reversed by
 * launchd `KeepAlive: true` and/or the 5-minute watchdog.
 *
 * Engaging the killswitch from inside the bot does three things in order:
 *   1. Write the sentinel file (filesystem-permanent flag).
 *   2. Spawn `launchctl bootout` of the daemon job, detached, so the
 *      caller's process doesn't sit waiting for launchd to take it down.
 *   3. `process.exit(0)` after a short grace period (caller controls).
 *
 * Reviving requires the owner at a terminal:
 *
 *     rm ~/.mvpclaw/killswitch
 *     launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mvpclaw.daemon.plist
 *
 * Or simply `mvpclaw revive`, which does both atomically.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { detectInit, stopCommand } from '../platform/index.js';

/** Resolve the sentinel file path. Tests override. */
export function killswitchPath(override?: string): string {
  return override ?? join(homedir(), '.mvpclaw', 'killswitch');
}

/** Is the killswitch currently engaged? Cheap; just file-existence. */
export function isKillswitchActive(override?: string): boolean {
  return existsSync(killswitchPath(override));
}

/**
 * Remove the sentinel. Idempotent.
 *
 * @returns `true` if a sentinel existed before this call.
 */
export function disengageKillswitch(override?: string): boolean {
  const p = killswitchPath(override);
  if (!existsSync(p)) {
    return false;
  }
  rmSync(p);
  return true;
}

/** Write the sentinel without performing the destructive `launchctl bootout`. */
export function writeKillswitchSentinel(reason: string, override?: string): void {
  const p = killswitchPath(override);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `engaged-at: ${new Date().toISOString()}\nreason: ${reason}\n`, 'utf8');
}

/** Default daemon job label. Matches `com.mvpclaw.daemon.plist`. */
export const DAEMON_LABEL = 'com.mvpclaw.daemon';

/** Minimal sync-spawn shape so tests can inject a fake launchctl. */
export type SyncSpawn = (cmd: string, args: string[]) => { status: number | null; stderr?: string };

/** Outcome of `killDaemon()`. */
export interface KillResult {
  /** The sentinel was written (the watchdog will not restart the daemon). */
  killswitchEngaged: boolean;
  /** `launchctl bootout` removed a running daemon (exit 0). */
  bootedOut: boolean;
  /** Daemon was not loaded — bootout was a no-op, which is fine. */
  alreadyStopped: boolean;
  /** True when the kill is effective (sentinel engaged + daemon not running). */
  ok: boolean;
  /** launchctl stderr, if any. */
  stderr: string;
}

/**
 * Stop the daemon from a terminal — the inverse of `mvpclaw revive`.
 *
 * Writes the killswitch sentinel (so the watchdog won't resurrect the daemon)
 * then `launchctl bootout`s the job. Unlike {@link engageKillswitch}, this is a
 * synchronous, side-effect-contained call for the `mvpclaw kill` CLI command —
 * it does NOT `process.exit`. A non-zero bootout means the daemon was already
 * stopped, which is still a successful kill.
 *
 * @param opts - reason, optional plist path / uid / sentinel override, and an
 *               injectable `spawnImpl` (defaults to a real `launchctl` call).
 * @returns A {@link KillResult}.
 */
export function killDaemon(opts: {
  reason: string;
  plistPath?: string;
  uid?: string;
  sentinelOverride?: string;
  spawnImpl?: SyncSpawn;
}): KillResult {
  writeKillswitchSentinel(opts.reason, opts.sentinelOverride);
  const killswitchEngaged = isKillswitchActive(opts.sentinelOverride);
  const plist =
    opts.plistPath ?? join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
  const uid = opts.uid ?? String(userInfo().uid);
  const run: SyncSpawn =
    opts.spawnImpl ??
    ((cmd, args) => {
      const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
      return { status: r.status, stderr: r.stderr ?? '' };
    });
  // OS-aware: launchctl bootout on macOS, `systemctl --user stop` on Linux.
  const stop = stopCommand(detectInit(process.platform), {
    label: DAEMON_LABEL,
    plistPath: plist,
    uid,
  });
  const r = run(stop.cmd, stop.args);
  const bootedOut = r.status === 0;
  const alreadyStopped = !bootedOut;
  return {
    killswitchEngaged,
    bootedOut,
    alreadyStopped,
    ok: killswitchEngaged && (bootedOut || alreadyStopped),
    stderr: (r.stderr ?? '').trim(),
  };
}

/**
 * Engage the killswitch — sentinel + detached `launchctl bootout` + scheduled
 * `process.exit(0)` after `graceMs`. This is the IN-PROCESS variant called by
 * the bot itself (the `/killswitch` slash command); for the `mvpclaw kill` CLI
 * use {@link killDaemon}, which does not exit the process.
 *
 * @param reason - Free-text reason, written into the sentinel.
 * @param graceMs - Milliseconds to wait before `process.exit`. Default 5000 —
 *                  enough for the outbox to flush the "killswitch engaged" reply.
 * @param plistPath - Path to the daemon plist (for `bootout`'s arg form).
 * @param override - Sentinel-path override (tests).
 */
export function engageKillswitch(
  reason: string,
  graceMs = 5000,
  plistPath?: string,
  override?: string,
): void {
  writeKillswitchSentinel(reason, override);
  const plist = plistPath ?? join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
  // Detach the bootout so it survives our exit. The script may run after
  // we're already gone; that's fine — launchd processes bootout regardless.
  const child = spawn(
    '/bin/sh',
    ['-c', `( sleep 1 && /bin/launchctl bootout "gui/$(id -u)" "${plist}" ) >/dev/null 2>&1 &`],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  setTimeout(() => {
    process.exit(0);
  }, graceMs).unref();
}
