/**
 * Logging area — Pino logger factory + the canonical secret redactor.
 *
 * The logger writes structured JSON to STDERR (never stdout). The redactor is
 * the single source of truth for what counts as a secret, and is reused by
 * the trace writer and memory append path.
 */
export { makeLogger } from './logger.js';
export { redactString, redactPaths } from './redact.js';
