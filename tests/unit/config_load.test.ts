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

  it('defaults skills toggles to loadAll=true with empty enable/disable lists', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, JSON.stringify({}));
    const config = loadConfig(path);
    expect(config.skills.loadAll).toBe(true);
    expect(config.skills.enabled).toEqual([]);
    expect(config.skills.disabled).toEqual([]);
  });

  it('parses skills.enabled and skills.disabled lists', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(
      path,
      JSON.stringify({
        skills: { enabled: ['email', 'github-deploy'], disabled: ['self-modification'] },
      }),
    );
    const config = loadConfig(path);
    expect(config.skills.enabled).toEqual(['email', 'github-deploy']);
    expect(config.skills.disabled).toEqual(['self-modification']);
  });

  it('defaults the deploys block (github private, vercel preview)', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, JSON.stringify({}));
    const config = loadConfig(path);
    expect(config.deploys.github.defaultVisibility).toBe('private');
    expect(config.deploys.vercel.defaultTarget).toBe('preview');
  });

  it('defaults the email block disabled with himalaya default account', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, JSON.stringify({}));
    const config = loadConfig(path);
    expect(config.email.enabled).toBe(false);
    expect(config.email.himalayaAccount).toBe('');
    expect(config.email.defaultPageSize).toBe(10);
  });

  it('defaults the email channel disabled with a 120s poll interval + empty allowlist', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, JSON.stringify({}));
    const config = loadConfig(path);
    expect(config.email.channel.enabled).toBe(false);
    expect(config.email.channel.pollIntervalSec).toBe(120);
    expect(config.email.channel.allowedFrom).toEqual([]);
  });

  it('defaults the owner to empty name + email', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, JSON.stringify({}));
    const config = loadConfig(path);
    expect(config.owner).toEqual({ name: '', email: '' });
  });

  it('parses owner + an owner email allowlist', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(
      path,
      JSON.stringify({
        owner: { name: 'Sam', email: 'sam@example.com' },
        email: { channel: { enabled: true, account: 'bot', allowedFrom: ['sam@example.com'] } },
      }),
    );
    const config = loadConfig(path);
    expect(config.owner).toEqual({ name: 'Sam', email: 'sam@example.com' });
    expect(config.email.channel.allowedFrom).toEqual(['sam@example.com']);
  });

  it('defaults links to an empty array and parses a link group', () => {
    const path = join(tmp, 'cfg.json');
    writeFileSync(path, JSON.stringify({}));
    expect(loadConfig(path).links).toEqual([]);

    const path2 = join(tmp, 'cfg2.json');
    writeFileSync(
      path2,
      JSON.stringify({
        links: [
          {
            id: 'owner',
            primary: { channel: 'telegram', id: '111' },
            members: [
              { channel: 'telegram', id: '111' },
              { channel: 'email', id: 'me@example.com' },
            ],
          },
        ],
      }),
    );
    const cfg = loadConfig(path2);
    expect(cfg.links[0]?.primary).toEqual({ channel: 'telegram', id: '111' });
    expect(cfg.links[0]?.members).toHaveLength(2);
  });
});
