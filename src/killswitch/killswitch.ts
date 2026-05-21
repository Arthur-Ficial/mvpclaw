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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

/**
 * Engage the killswitch — sentinel + detached `launchctl bootout` + scheduled
 * `process.exit(0)` after `graceMs`.
 *
 * The `bootout` removes the job from launchd entirely so its `KeepAlive: true`
 * cannot resurrect us. The watchdog, scheduled every 5 min, sees the sentinel
 * and refuses to bootstrap a new daemon until the owner revives.
 *
 * @param reason - Free-text reason, written into the sentinel.
 * @param graceMs - Milliseconds to wait before `process.exit`. Default 5000 —
 *                  enough for the outbox to flush the "killswitch engaged"
 *                  reply to Telegram.
 * @param plistPath - Path to the daemon plist (for `bootout`'s arg form).
 *                    Defaults to `~/Library/LaunchAgents/com.mvpclaw.daemon.plist`.
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
