/**
 * Platform service-manager abstraction tests — maps the daemon lifecycle to the
 * host init system (launchd on macOS, systemd --user on Linux) so kill/revive/
 * watchdog work cross-platform. Pure argv builders, no spawning.
 */
import { describe, it, expect } from 'vitest';
import {
  detectInit,
  stopCommand,
  startCommand,
  restartCommand,
} from '../../src/platform/service.js';

const opts = {
  label: 'com.mvpclaw.daemon',
  plistPath: '/home/u/.config/.../com.mvpclaw.daemon.plist',
  uid: '501',
};

describe('detectInit', () => {
  it('darwin → launchd, linux → systemd', () => {
    expect(detectInit('darwin')).toBe('launchd');
    expect(detectInit('linux')).toBe('systemd');
  });
  it('unknown platforms fall back to systemd', () => {
    expect(detectInit('freebsd')).toBe('systemd');
  });
});

describe('launchd commands (macOS)', () => {
  it('stop = launchctl bootout gui/<uid> <plist>', () => {
    expect(stopCommand('launchd', opts)).toEqual({
      cmd: '/bin/launchctl',
      args: ['bootout', 'gui/501', opts.plistPath],
    });
  });
  it('start = launchctl bootstrap gui/<uid> <plist>', () => {
    expect(startCommand('launchd', opts)).toEqual({
      cmd: '/bin/launchctl',
      args: ['bootstrap', 'gui/501', opts.plistPath],
    });
  });
  it('restart = launchctl kickstart -k gui/<uid>/<label>', () => {
    expect(restartCommand('launchd', opts)).toEqual({
      cmd: '/bin/launchctl',
      args: ['kickstart', '-k', 'gui/501/com.mvpclaw.daemon'],
    });
  });
});

describe('systemd commands (Linux, --user)', () => {
  it('stop = systemctl --user stop <label>.service', () => {
    expect(stopCommand('systemd', opts)).toEqual({
      cmd: 'systemctl',
      args: ['--user', 'stop', 'com.mvpclaw.daemon.service'],
    });
  });
  it('start = systemctl --user start <label>.service', () => {
    expect(startCommand('systemd', opts)).toEqual({
      cmd: 'systemctl',
      args: ['--user', 'start', 'com.mvpclaw.daemon.service'],
    });
  });
  it('restart = systemctl --user restart <label>.service', () => {
    expect(restartCommand('systemd', opts)).toEqual({
      cmd: 'systemctl',
      args: ['--user', 'restart', 'com.mvpclaw.daemon.service'],
    });
  });
});
