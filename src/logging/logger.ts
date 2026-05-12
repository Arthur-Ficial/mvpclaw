/**
 * Single Pino logger factory.
 *
 * Writes to STDERR by default — never STDOUT — so it does not interfere with
 * the CLI's stdout discipline (stdout is reserved for data; stderr for logs).
 *
 * The redact list comes from `config.logging.redact` and is consumed by Pino's
 * built-in redaction. For free-text logging, callers should pre-run their
 * strings through `redactString()` from `./redact`.
 *
 * @example
 * ```ts
 * const log = makeLogger(config);
 * log.info({ chatId: 'c-1' }, 'inbound message received');
 * ```
 */
import pino, { type Logger } from 'pino';
import type { LoggingConfig } from '../config/config.schema.js';
import { redactPaths } from './redact.js';

/**
 * Build a Pino logger from the resolved config.
 *
 * @param config - Logging config block from the loaded `mvpclaw.config.json`.
 * @returns A Pino logger writing structured JSON to stderr.
 */
export function makeLogger(config: LoggingConfig): Logger {
  return pino(
    {
      level: config.level,
      redact: {
        paths: redactPaths(config.redact),
        censor: '<redacted>',
      },
      base: { component: 'mvpclaw' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ fd: 2 }),
  );
}
