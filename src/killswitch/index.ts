/**
 * Killswitch area — the single escape hatch from `KeepAlive: true` +
 * 5-minute watchdog supervision.
 *
 * One file, four pure-ish functions. The agent calls `engageKillswitch`
 * from the `/killswitch` slash command. The watchdog script checks
 * `isKillswitchActive` (via the sentinel file's existence on disk) before
 * deciding whether to bootstrap the daemon. The `mvpclaw revive` CLI
 * command calls `disengageKillswitch` plus a launchctl bootstrap.
 */
export {
  DAEMON_LABEL,
  disengageKillswitch,
  engageKillswitch,
  isKillswitchActive,
  killswitchPath,
  writeKillswitchSentinel,
} from './killswitch.js';
