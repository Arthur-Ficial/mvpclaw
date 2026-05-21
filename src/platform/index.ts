/**
 * Platform area — cross-OS abstractions so the daemon lifecycle works on Linux
 * (systemd, the primary deploy target) and macOS (launchd). Pure argv builders;
 * the CLI commands + watchdog resolve the host init system via `detectInit`.
 */
export { detectInit, stopCommand, startCommand, restartCommand } from './service.js';
export type { InitSystem, ServiceTarget, PlatformCommand } from './service.js';
