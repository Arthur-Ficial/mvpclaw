/**
 * Sanity test for the `nowIso` SSOT — every repo INSERT depends on it.
 */
import { describe, expect, it, vi } from 'vitest';
import { nowIso } from '../../src/lib/index.js';

describe('nowIso', () => {
  it('returns a UTC ISO-8601 string ending in Z', () => {
    const s = nowIso();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('reflects fake timers (useful for repo determinism tests)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:34:56.789Z'));
    expect(nowIso()).toBe('2026-05-13T12:34:56.789Z');
    vi.useRealTimers();
  });
});
