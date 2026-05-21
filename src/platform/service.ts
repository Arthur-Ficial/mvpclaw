/**
 * Platform service-manager abstraction.
 *
 * MVPClaw runs as a supervised daemon. The init system differs by OS — macOS
 * uses launchd (`launchctl`), Linux uses systemd (`systemctl --user`). This
 * module maps the three lifecycle verbs (stop / start / restart) to the right
 * argv for the host, so `kill` / `revive` / the watchdog are cross-platform.
 *
 * Pure argv builders (no spawning) so they unit-test without a real init system.
 */

/** Supported init systems. */
export type InitSystem = 'launchd' | 'systemd';

/** What a lifecycle verb needs to address the service on either init system. */
export interface ServiceTarget {
  /** Job label, e.g. `com.mvpclaw.daemon` (also the systemd unit base name). */
  label: string;
  /** launchd plist path (ignored by systemd). */
  plistPath: string;
  /** Numeric uid (launchd `gui/<uid>` domain; ignored by systemd --user). */
  uid: string;
}

/** A resolved command: executable + args (no shell). */
export interface PlatformCommand {
  cmd: string;
  args: string[];
}

/**
 * Detect the init system for a platform string (`process.platform`).
 *
 * @param platform - e.g. `'darwin'`, `'linux'`.
 * @returns `'launchd'` on macOS, `'systemd'` everywhere else (the Linux-first default).
 */
export function detectInit(platform: string): InitSystem {
  return platform === 'darwin' ? 'launchd' : 'systemd';
}

/** Build the STOP command for the given init system. */
export function stopCommand(init: InitSystem, t: ServiceTarget): PlatformCommand {
  return init === 'launchd'
    ? { cmd: '/bin/launchctl', args: ['bootout', `gui/${t.uid}`, t.plistPath] }
    : { cmd: 'systemctl', args: ['--user', 'stop', `${t.label}.service`] };
}

/** Build the START command for the given init system. */
export function startCommand(init: InitSystem, t: ServiceTarget): PlatformCommand {
  return init === 'launchd'
    ? { cmd: '/bin/launchctl', args: ['bootstrap', `gui/${t.uid}`, t.plistPath] }
    : { cmd: 'systemctl', args: ['--user', 'start', `${t.label}.service`] };
}

/** Build the RESTART command for the given init system (watchdog uses this). */
export function restartCommand(init: InitSystem, t: ServiceTarget): PlatformCommand {
  return init === 'launchd'
    ? { cmd: '/bin/launchctl', args: ['kickstart', '-k', `gui/${t.uid}/${t.label}`] }
    : { cmd: 'systemctl', args: ['--user', 'restart', `${t.label}.service`] };
}
