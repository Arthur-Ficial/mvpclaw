/**
 * Library area — small, stateless utilities shared across MVPClaw.
 *
 * Functions here have no dependencies on the rest of the codebase except
 * Node built-ins. Use this for SSOT helpers (env-file parsing, etc.) that
 * are imported from CLI, tests, scripts, and library code alike.
 */
export { loadEnvFile } from './env-loader.js';
