/**
 * Killswitch area — the single escape hatch from `KeepAlive: true` +
 * 5-minute watchdog supervision.
 *
 * The agent calls `engageKillswitch` from the `/killswitch` slash command.
 * The watchdog script checks `isKillswitchActive` (via the sentinel file's
 * existence on disk) before deciding whether to bootstrap the daemon. The
 * `mvpclaw kill` CLI command calls `killDaemon` (sentinel + launchctl bootout);
 * `mvpclaw revive` calls `disengageKillswitch` plus a launchctl bootstrap.
 */
export {
  DAEMON_LABEL,
  disengageKillswitch,
  engageKillswitch,
  isKillswitchActive,
  killDaemon,
  killswitchPath,
  writeKillswitchSentinel,
} from './killswitch.js';
export type { KillResult, SyncSpawn } from './killswitch.js';
