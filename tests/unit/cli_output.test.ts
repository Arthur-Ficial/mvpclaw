import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveOutputContext,
  writeOut,
  writeJsonLine,
  writeProgress,
} from '../../src/cli/output.js';

/**
 * Capture process.stdout.write + process.stderr.write so we can assert the
 * CLI output discipline: stdout = data only; stderr = logs/progress.
 */
function captureStdio(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  // Allow buffer or string; collect as utf8 strings.
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout.push(typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr.push(typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8'));
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout,
    stderr,
    restore: () => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    },
  };
}

describe('CLI output discipline — writeOut / writeJsonLine / writeProgress', () => {
  let cap: ReturnType<typeof captureStdio>;
  beforeEach(() => {
    cap = captureStdio();
  });
  afterEach(() => {
    cap.restore();
  });

  it('writeOut emits a single JSON line in JSON mode', () => {
    writeOut({ a: 1, b: 'x' }, { json: true, quiet: false, verbose: false });
    expect(cap.stdout.join('')).toBe('{"a":1,"b":"x"}\n');
    expect(cap.stderr.join('')).toBe('');
  });

  it('writeOut emits indented JSON for object in human mode', () => {
    writeOut({ a: 1 }, { json: false, quiet: false, verbose: false });
    expect(cap.stdout.join('')).toBe('{\n  "a": 1\n}\n');
  });

  it('writeOut emits a table for homogeneous array of rows in human mode', () => {
    writeOut(
      [
        { id: '1', name: 'a' },
        { id: '22', name: 'bb' },
      ],
      { json: false, quiet: false, verbose: false },
    );
    const out = cap.stdout.join('');
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('22');
    expect(out).toContain('bb');
  });

  it('writeOut emits compact JSON for array in JSON mode', () => {
    writeOut(
      [
        { id: '1', name: 'a' },
        { id: '22', name: 'bb' },
      ],
      { json: true, quiet: false, verbose: false },
    );
    expect(cap.stdout.join('')).toBe('[{"id":"1","name":"a"},{"id":"22","name":"bb"}]\n');
  });

  it('writeOut suppresses output when quiet', () => {
    writeOut({ a: 1 }, { json: true, quiet: true, verbose: false });
    expect(cap.stdout.join('')).toBe('');
    expect(cap.stderr.join('')).toBe('');
  });

  it('writeJsonLine always emits one JSON line to stdout, ignoring TTY', () => {
    writeJsonLine({ stream: true });
    expect(cap.stdout.join('')).toBe('{"stream":true}\n');
    expect(cap.stderr.join('')).toBe('');
  });

  it('writeProgress only emits to STDERR when verbose is true', () => {
    writeProgress('half-way', { json: true, quiet: false, verbose: false });
    expect(cap.stderr.join('')).toBe('');
    writeProgress('half-way', { json: true, quiet: false, verbose: true });
    expect(cap.stderr.join('')).toBe('mvpclaw: progress: half-way\n');
    expect(cap.stdout.join('')).toBe('');
  });

  it('resolveOutputContext honors --json flag', () => {
    expect(resolveOutputContext({ json: true })).toMatchObject({ json: true });
  });

  it('resolveOutputContext forces json when stdout is not a TTY', () => {
    // In the test runner, process.stdout.isTTY is undefined → not a TTY.
    expect(resolveOutputContext({})).toMatchObject({ json: true });
  });
});
