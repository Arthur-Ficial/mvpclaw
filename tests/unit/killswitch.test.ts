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
