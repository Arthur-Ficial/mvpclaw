/**
 * `.env` file loader — the SSOT for "load project credentials".
 *
 * Convention: **project `.env` wins over any pre-existing value** in the
 * target env object. MVPClaw runs on a Mac where `~/.env` exports may set
 * `OPENROUTER_API_KEY` etc. to global/stale values; the project's per-repo
 * `.env` is authoritative for project work.
 *
 * Imported from:
 *   - `src/cli/load-env.ts` — every CLI invocation (side-effect import)
 *   - `tests/e2e/real-telegram/_harness.ts` — vitest doesn't auto-load .env
 *   - `scripts/stress-ai.ts` — node tsx runner
 */
import { existsSync, readFileSync } from 'node:fs';

/**
 * Parse a `.env` file at `path` and write each `KEY=value` pair into `env`,
 * overriding any pre-existing value. No-op when the file does not exist.
 *
 * @param path - Absolute or relative path to a `.env` file.
 * @param env - The env object to populate; defaults to `process.env`.
 *
 * @example
 * ```ts
 * loadEnvFile(resolve(process.cwd(), '.env'));
 * ```
 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) {
    return;
  }
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}
