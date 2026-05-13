/**
 * RED → GREEN test for the .env loader. The loader is shared by:
 *   - the CLI entrypoint (project .env wins over shell env, every invocation)
 *   - the real-Telegram harness (vitest doesn't auto-load .env)
 *   - the stress-ai runner script
 *
 * Before this commit, each callsite had its own copy of the parser. This test
 * pins the SSOT behaviour: parse a .env file from disk and override
 * `process.env` for the listed keys.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnvFile } from '../../src/lib/env-loader.js';

function withTmpEnv(content: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mvpclaw-env-test-'));
  const path = join(dir, '.env');
  writeFileSync(path, content, 'utf8');
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadEnvFile', () => {
  it('parses simple KEY=value lines into the provided env object', () => {
    const env: NodeJS.ProcessEnv = {};
    withTmpEnv('FOO=bar\nBAZ=quux\n', (p) => {
      loadEnvFile(p, env);
    });
    expect(env['FOO']).toBe('bar');
    expect(env['BAZ']).toBe('quux');
  });

  it('skips blank lines and comment lines starting with #', () => {
    const env: NodeJS.ProcessEnv = {};
    withTmpEnv('# header comment\n\nFOO=1\n\n# inline\nBAR=2\n', (p) => {
      loadEnvFile(p, env);
    });
    expect(env['FOO']).toBe('1');
    expect(env['BAR']).toBe('2');
  });

  it('strips matching single OR double quotes from values', () => {
    const env: NodeJS.ProcessEnv = {};
    withTmpEnv(`A="double"\nB='single'\nC=bare\nD="unbalanced'\n`, (p) => {
      loadEnvFile(p, env);
    });
    expect(env['A']).toBe('double');
    expect(env['B']).toBe('single');
    expect(env['C']).toBe('bare');
    // Unbalanced — quotes preserved
    expect(env['D']).toBe(`"unbalanced'`);
  });

  it('OVERRIDES existing values in the env object (project wins over shell)', () => {
    const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'stale-shell-value' };
    withTmpEnv('OPENROUTER_API_KEY=project-fresh-value\n', (p) => {
      loadEnvFile(p, env);
    });
    expect(env['OPENROUTER_API_KEY']).toBe('project-fresh-value');
  });

  it('is a no-op when the file does not exist (no throw)', () => {
    const env: NodeJS.ProcessEnv = { PRE: 'kept' };
    loadEnvFile('/this/path/definitely/does/not/exist.env', env);
    expect(env['PRE']).toBe('kept');
  });

  it('handles values that contain an "=" character', () => {
    const env: NodeJS.ProcessEnv = {};
    withTmpEnv('URL=https://example.com/?a=1&b=2\n', (p) => {
      loadEnvFile(p, env);
    });
    expect(env['URL']).toBe('https://example.com/?a=1&b=2');
  });

  it('trims whitespace around keys and values', () => {
    const env: NodeJS.ProcessEnv = {};
    withTmpEnv('  FOO   =   bar   \n', (p) => {
      loadEnvFile(p, env);
    });
    expect(env['FOO']).toBe('bar');
  });
});
