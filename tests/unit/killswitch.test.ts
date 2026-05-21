/**
 * Killswitch sentinel + revive tests. Test process never calls
 * `engageKillswitch` directly — that would `process.exit(0)` and bring
 * the test runner down. We test the side-effect-free pieces
 * (`writeKillswitchSentinel`, `isKillswitchActive`, `disengageKillswitch`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  disengageKillswitch,
  isKillswitchActive,
  killDaemon,
  killswitchPath,
  writeKillswitchSentinel,
} from '../../src/killswitch/index.js';

let tmp: string;
let sentinel: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-ks-'));
  sentinel = join(tmp, 'killswitch');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('killswitch sentinel', () => {
  it('isKillswitchActive returns false when no sentinel exists', () => {
    expect(isKillswitchActive(sentinel)).toBe(false);
  });

  it('writeKillswitchSentinel creates the file with reason + timestamp', () => {
    writeKillswitchSentinel('manual stop via /killswitch', sentinel);
    expect(isKillswitchActive(sentinel)).toBe(true);
    const body = readFileSync(sentinel, 'utf8');
    expect(body).toMatch(/engaged-at: \d{4}-/);
    expect(body).toMatch(/reason: manual stop via \/killswitch/);
  });

  it('disengageKillswitch returns true on remove, false on already-gone', () => {
    writeKillswitchSentinel('x', sentinel);
    expect(disengageKillswitch(sentinel)).toBe(true);
    expect(existsSync(sentinel)).toBe(false);
    expect(disengageKillswitch(sentinel)).toBe(false);
  });

  it('default killswitchPath points under ~/.mvpclaw/', () => {
    const def = killswitchPath();
    expect(def).toMatch(/\.mvpclaw\/killswitch$/);
  });
});

describe('killDaemon (mvpclaw kill)', () => {
  it('engages the sentinel and boots out the daemon via launchctl', () => {
    const calls: Array<[string, string[]]> = [];
    const r = killDaemon({
      reason: 'manual stop via mvpclaw kill',
      uid: '501',
      plistPath: '/x/com.mvpclaw.daemon.plist',
      sentinelOverride: sentinel,
      spawnImpl: (cmd, a) => {
        calls.push([cmd, a]);
        return { status: 0 };
      },
    });
    expect(isKillswitchActive(sentinel)).toBe(true);
    expect(r.killswitchEngaged).toBe(true);
    expect(r.bootedOut).toBe(true);
    expect(r.ok).toBe(true);
    expect(calls[0]?.[0]).toBe('/bin/launchctl');
    expect(calls[0]?.[1]).toEqual(['bootout', 'gui/501', '/x/com.mvpclaw.daemon.plist']);
  });

  it('treats a not-loaded daemon (bootout non-zero) as already stopped, still ok', () => {
    const r = killDaemon({
      reason: 'x',
      uid: '501',
      plistPath: '/x.plist',
      sentinelOverride: sentinel,
      spawnImpl: () => ({ status: 3, stderr: 'Boot-out failed: 3: No such process' }),
    });
    expect(r.killswitchEngaged).toBe(true);
    expect(r.bootedOut).toBe(false);
    expect(r.alreadyStopped).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('engaging kill then revive (disengage) round-trips the sentinel', () => {
    killDaemon({
      reason: 'r',
      uid: '1',
      plistPath: '/p',
      sentinelOverride: sentinel,
      spawnImpl: () => ({ status: 0 }),
    });
    expect(isKillswitchActive(sentinel)).toBe(true);
    expect(disengageKillswitch(sentinel)).toBe(true);
    expect(isKillswitchActive(sentinel)).toBe(false);
  });
});
