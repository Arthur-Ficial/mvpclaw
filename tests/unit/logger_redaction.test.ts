import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { redactPaths } from '../../src/logging/redact.js';

/**
 * The logger logs to a custom writable so we can inspect the JSON output and
 * assert that secrets are redacted before any byte leaves the process.
 */
describe('Pino logger — secret redaction at the structured-log boundary', () => {
  let captured: string[];
  let stream: Writable;

  beforeEach(() => {
    captured = [];
    stream = new Writable({
      write(chunk, _enc, cb) {
        captured.push(chunk.toString('utf8'));
        cb();
      },
    });
  });

  afterEach(() => {
    stream.destroy();
  });

  it('redacts configured paths in the log object (default <redacted> censor)', () => {
    const log = pino(
      {
        level: 'info',
        redact: { paths: redactPaths(['OPENROUTER_API_KEY']), censor: '<redacted>' },
      },
      stream,
    );

    log.info({ OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijklmnop' }, 'leaked?');
    const lines = captured.join('').trim().split('\n');
    expect(lines.length).toBe(1);
    const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(event['OPENROUTER_API_KEY']).toBe('<redacted>');
  });

  it('redacts a nested env-name path under `*.NAME`', () => {
    const log = pino(
      {
        level: 'info',
        redact: { paths: redactPaths(['TELEGRAM_BOT_TOKEN']), censor: '<redacted>' },
      },
      stream,
    );

    log.info(
      { env: { TELEGRAM_BOT_TOKEN: '1234567890:AAHwIUabcdefghijklmnopqrstuvwxyz12' } },
      'nested',
    );
    const event = JSON.parse(captured.join('').trim()) as { env: { TELEGRAM_BOT_TOKEN: unknown } };
    expect(event.env.TELEGRAM_BOT_TOKEN).toBe('<redacted>');
  });

  it('does not redact unrelated keys', () => {
    const log = pino(
      {
        level: 'info',
        redact: { paths: redactPaths(['SECRET']), censor: '<redacted>' },
      },
      stream,
    );
    log.info({ chatId: 'c-1', userId: 'u-1' }, 'unrelated');
    const event = JSON.parse(captured.join('').trim()) as Record<string, unknown>;
    expect(event['chatId']).toBe('c-1');
    expect(event['userId']).toBe('u-1');
  });
});
