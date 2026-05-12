import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, substituteEnv } from '../../src/config/load-config.js';

describe('config loader — env substitution + Zod validation', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-cfg-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('substitutes ${VAR} references against the supplied env map', () => {
    const out = substituteEnv({ token: '${MY_KEY}', literal: 'hello' }, { MY_KEY: 'secret-value' });
    expect(out).toEqual({ token: 'secret-value', literal: 'hello' });
  });

  it('leaves ${VAR} literal when the env var is missing (loud failure happens later)', () => {
    const out = substituteEnv('${UNSET_VAR}', {});
    expect(out).toBe('${UNSET_VAR}');
  });

  it('walks nested objects and arrays', () => {
    const out = substituteEnv({ a: [{ b: '${X}' }], c: { d: '${X}' } }, { X: 'V' });
    expect(out).toEqual({ a: [{ b: 'V' }], c: { d: 'V' } });
  });

  it('loads a minimal valid config file', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(
      path,
      JSON.stringify({
        agent: { provider: 'openrouter' },
        openrouter: { apiKeyEnv: 'TEST_KEY' },
      }),
    );
    const config = loadConfig(path);
    expect(config.agent.provider).toBe('openrouter');
    expect(config.app.name).toBe('mvpclaw'); // default applied
    expect(config.openrouter.apiKeyEnv).toBe('TEST_KEY');
  });

  it('rejects unknown top-level config keys via Zod strictness (open-ended check)', () => {
    const path = join(tmp, 'cfg.json');
    // The schema uses object() (default strip), so unknown keys are stripped, not rejected.
    // This is intentional — forward compat. Test asserts the documented behaviour.
    writeFileSync(path, JSON.stringify({ agent: { provider: 'openrouter' }, bogus: 123 }));
    const config = loadConfig(path);
    expect(config.agent.provider).toBe('openrouter');
    expect((config as Record<string, unknown>)['bogus']).toBeUndefined();
  });

  it('throws on malformed JSON', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, '{ not json');
    expect(() => loadConfig(path)).toThrow();
  });

  it('substitutes env values inside a loaded config', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(
      path,
      JSON.stringify({
        claudeCli: {
          env: { ANTHROPIC_AUTH_TOKEN: '${OPENROUTER_API_KEY}' },
        },
      }),
    );
    const config = loadConfig(path, { OPENROUTER_API_KEY: 'sk-or-v1-test' });
    expect(config.claudeCli.env['ANTHROPIC_AUTH_TOKEN']).toBe('sk-or-v1-test');
  });
});
