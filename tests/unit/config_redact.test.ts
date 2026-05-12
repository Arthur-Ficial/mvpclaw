import { describe, it, expect } from 'vitest';
import { redactString, redactPaths } from '../../src/logging/redact.js';

describe('secret redactor', () => {
  it('masks Telegram bot token shape', () => {
    const out = redactString('bot=1234567890:AAHwIUabcdefghijklmnopqrstuvwxyz12');
    expect(out).toContain('<redacted-tg-token>');
    expect(out).not.toContain('AAHwIU');
  });

  it('masks sk-or- provider keys', () => {
    const out = redactString(
      'OPENROUTER_API_KEY=sk-or-v1-abcdef1234567890abcdef1234567890abcdef12',
    );
    // The "API_KEY=" generic pattern fires first; that itself already redacts the value.
    expect(out).not.toContain('sk-or-v1-abcdef');
  });

  it('masks generic api-key/secret/bearer/password assignments', () => {
    const cases = [
      'api-key: hunter2',
      'API_KEY=hunter2',
      'secret = topsecret',
      'token: Bearerxyz',
      'bearer abc123',
      'password=letmein',
    ];
    for (const c of cases) {
      const out = redactString(c);
      expect(out, c).not.toContain('hunter2');
      expect(out, c).not.toContain('topsecret');
      expect(out, c).not.toContain('letmein');
    }
  });

  it('masks long base64 chunks', () => {
    const b64 = 'A'.repeat(48);
    const out = redactString(`payload=${b64}`);
    expect(out).toContain('<redacted-base64>');
  });

  it('masks env values by exact match when no other pattern would catch them', () => {
    const originalEnv = process.env['TEST_REDACT_VAL'];
    // Pick a value that no generic pattern matches (no "token:" prefix, no key prefix, < 32 chars).
    process.env['TEST_REDACT_VAL'] = 'BareInnocuousString12';
    try {
      const out = redactString('The configured value is BareInnocuousString12 actually', [
        'TEST_REDACT_VAL',
      ]);
      expect(out).toContain('<redacted:TEST_REDACT_VAL>');
      expect(out).not.toContain('BareInnocuousString12');
    } finally {
      if (originalEnv === undefined) {
        delete process.env['TEST_REDACT_VAL'];
      } else {
        process.env['TEST_REDACT_VAL'] = originalEnv;
      }
    }
  });

  it('eliminates the secret value regardless of which redaction layer fires first', () => {
    // Belt-and-braces: even if the generic "token: <val>" pattern beats the env-name match,
    // the security property — secret is gone — must still hold.
    const originalEnv = process.env['TEST_REDACT_VAL'];
    process.env['TEST_REDACT_VAL'] = 'unique-token-12345678';
    try {
      const out = redactString('Got the token: unique-token-12345678 in a chat', [
        'TEST_REDACT_VAL',
      ]);
      expect(out).not.toContain('unique-token-12345678');
      expect(out).toMatch(/<redacted[-:]/);
    } finally {
      if (originalEnv === undefined) {
        delete process.env['TEST_REDACT_VAL'];
      } else {
        process.env['TEST_REDACT_VAL'] = originalEnv;
      }
    }
  });

  it('returns Pino-compatible redact paths', () => {
    const paths = redactPaths(['OPENROUTER_API_KEY', 'TELEGRAM_BOT_TOKEN']);
    expect(paths).toContain('OPENROUTER_API_KEY');
    expect(paths).toContain('*.OPENROUTER_API_KEY');
    expect(paths).toContain('TELEGRAM_BOT_TOKEN');
  });
});
