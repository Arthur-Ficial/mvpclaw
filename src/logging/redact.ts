/**
 * Secret redactor — the single source of truth for what gets masked.
 *
 * Used by:
 *   - the Pino logger (`src/logging/logger.ts`)
 *   - the trace writer (`src/app/run-tracer.ts`, added in P4)
 *   - the memory append path (`src/memory/memory-tools.ts`, added in P17)
 *
 * Two surfaces:
 *
 *   `redactPaths(config)` returns a string array of dotted paths suitable for
 *     Pino's `redact: { paths }` option — masks structured object keys.
 *
 *   `redactString(text, envNames)` runs regex-based masking over free text —
 *     catches secrets that leaked into prose (e.g. an LLM put `OPENROUTER_API_KEY=sk-or-...`
 *     in a memory append). Patterns:
 *       - `(?i)(api[-_ ]?key|secret|token|bearer|password)[ :=]+\S+`
 *       - Provider-key prefixes (`sk-`, `sk-or-`, `ghp_`, `xoxb-`) length ≥ 20
 *       - Telegram bot token shape: `\d{8,12}:[A-Za-z0-9_-]{30,}`
 *       - Base64 of length ≥ 32
 *       - Exact env-var VALUES (looked up from `envNames`) — most reliable
 *
 * The redactor is a defensive net, not a guarantee. Secrets should never be
 * placed into prompt text, memory, or traces in the first place.
 */

/** Build Pino-compatible dotted paths from the user's redact config list. */
export function redactPaths(envNames: readonly string[]): string[] {
  // Pino redacts paths in the LOG OBJECT — so the typical pattern is to log
  // the env name (e.g. `{ TELEGRAM_BOT_TOKEN: '...' }`) and have Pino mask it.
  return envNames.flatMap((n) => [n, `*.${n}`, `*.*.${n}`]);
}

const REDACTED_SECRET = '<redacted-secret>';
const REDACTED_KEY = '<redacted-key>';
const REDACTED_TG = '<redacted-tg-token>';
const REDACTED_B64 = '<redacted-base64>';

const PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Telegram bot token shape (specific — must come before the generic key match)
  { re: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, replacement: REDACTED_TG },
  // Common provider key prefixes
  { re: /\bsk-or-[A-Za-z0-9_-]{16,}\b/g, replacement: REDACTED_KEY },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: REDACTED_KEY },
  { re: /\bghp_[A-Za-z0-9_-]{20,}\b/g, replacement: REDACTED_KEY },
  { re: /\bxoxb-[A-Za-z0-9_-]{20,}\b/g, replacement: REDACTED_KEY },
  // Generic "key=value" / "token: value"
  {
    re: /\b(api[-_ ]?key|secret|token|bearer|password)\s*[:=]\s*[^\s]+/gi,
    replacement: '$1=' + REDACTED_SECRET,
  },
  // Long base64 chunks (≥ 32 chars)
  { re: /\b[A-Za-z0-9+/]{32,}={0,2}\b/g, replacement: REDACTED_B64 },
];

/**
 * Redact secrets from a free-text string.
 *
 * @param text - The text to scan.
 * @param envNames - Env-var names whose VALUES should also be redacted by
 *                   exact-match (lifted from `process.env`).
 * @returns The redacted text.
 */
export function redactString(text: string, envNames: readonly string[] = []): string {
  let out = text;
  // 1) Exact env values first (most reliable, no false positives)
  for (const name of envNames) {
    const val = process.env[name];
    if (typeof val === 'string' && val.length >= 8) {
      // Replace every literal occurrence of the env value.
      out = out.split(val).join('<redacted:' + name + '>');
    }
  }
  // 2) Pattern-based masking
  for (const { re, replacement } of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}
