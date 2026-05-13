/**
 * Project-scoped `.env` loader — side-effect-only module.
 *
 * MVPClaw owns its own credentials (per-project OpenRouter / Anthropic /
 * Gemini / Telegram keys). The user's shell may also export same-named env
 * vars from a global `~/.env` — those are STALE for project work and must
 * not mask the project key. Convention here: project `.env` wins.
 *
 * Imported FIRST (before any other module) by `src/cli/main.ts` so that
 * `process.env` is populated before any provider/config module reads it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
