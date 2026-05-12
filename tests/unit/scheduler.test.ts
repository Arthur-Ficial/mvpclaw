import { describe, it, expect } from 'vitest';
import { canTransition, isTerminal, startTickLoop } from '../../src/scheduler/index.js';

describe('scheduler — lifecycle transitions', () => {
  it('legal transitions match the spec', () => {
    expect(canTransition('scheduled', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('failed', 'scheduled')).toBe(true);
    expect(canTransition('failed', 'dead')).toBe(true);
    expect(canTransition('paused', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
  });

  it('illegal transitions are rejected', () => {
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('cancelled', 'scheduled')).toBe(false);
    expect(canTransition('dead', 'running')).toBe(false);
    expect(canTransition('scheduled', 'completed')).toBe(false);
  });

  it('terminal states are recognized', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('dead')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('scheduled')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });
});

describe('scheduler — drift-corrected tick loop', () => {
  it('fires the expected number of ticks over a short window', async () => {
    let calls = 0;
    const loop = startTickLoop({
      tickMs: 50,
      sweepMs: 1_000_000,
      onTick: () => {
        calls++;
      },
      onSweep: () => {},
    });
    // Let it run for ~200ms — should fire 3-5 times.
    await new Promise((r) => setTimeout(r, 220));
    await loop.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(6);
  });

  it('uses anchor-relative scheduling (drift stays bounded)', async () => {
    const timestamps: number[] = [];
    const loop = startTickLoop({
      tickMs: 30,
      sweepMs: 10_000,
      onTick: () => {
        timestamps.push(Date.now());
      },
      onSweep: () => {},
    });
    await new Promise((r) => setTimeout(r, 250));
    await loop.stop();
    // Compute average drift between consecutive ticks.
    if (timestamps.length >= 4) {
      const deltas: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        deltas.push((timestamps[i] as number) - (timestamps[i - 1] as number));
      }
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      // Average should be close to 30ms (we allow 25-60ms slack — event loop is noisy).
      expect(avg).toBeGreaterThan(25);
      expect(avg).toBeLessThan(60);
    }
  });

  it('stop() resolves cleanly and prevents further callbacks', async () => {
    let calls = 0;
    const loop = startTickLoop({
      tickMs: 20,
      sweepMs: 1_000_000,
      onTick: () => {
        calls++;
      },
      onSweep: () => {},
    });
    await new Promise((r) => setTimeout(r, 60));
    await loop.stop();
    const after = calls;
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toBe(after);
  });
});
