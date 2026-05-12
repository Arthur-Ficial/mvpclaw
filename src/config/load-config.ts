/**
 * Loads `mvpclaw.config.json` (or the path in `MVPCLAW_CONFIG`), substitutes
 * `${ENV_VAR}` references against `process.env`, validates against the Zod
 * schema, and returns an immutable config object.
 *
 * Substitution rules:
 * - `"${VAR}"` is replaced by `process.env.VAR` if defined; otherwise the
 *   exact literal `${VAR}` is preserved (loud failure happens at use time).
 * - Substitution applies only to string values; objects and arrays are walked.
 * - Substitution happens BEFORE Zod parsing so the schema validates the final
 *   resolved values.
 *
 * The loader throws on any I/O or validation failure; callers SHOULD let the
 * exception propagate to a top-level CLI handler that maps it to `exitConfig`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MvpClawConfig, type MvpClawConfig as MvpClawConfigType } from './config.schema.js';

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Recursively substitute `${ENV}` references in a JSON-ish value tree.
 *
 * @param value - The value to walk (string / object / array / primitive).
 * @param env - The environment map (typically `process.env`).
 * @returns The same shape with `${ENV}` references substituted.
 */
export function substituteEnv(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_REF, (_match, name: string) => {
      const v = env[name];
      return typeof v === 'string' ? v : `\${${name}}`;
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteEnv(v, env));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteEnv(v, env);
    }
    return out;
  }
  return value;
}

/**
 * Resolve the config file path. Honors `MVPCLAW_CONFIG`; default `./mvpclaw.config.json`.
 *
 * @param override - Explicit path override (typically from a CLI `--config` flag).
 * @returns Absolute path to the config file.
 */
export function resolveConfigPath(override?: string): string {
  const path = override ?? process.env['MVPCLAW_CONFIG'] ?? './mvpclaw.config.json';
  return resolve(process.cwd(), path);
}

/**
 * Load, env-substitute, and validate a config file.
 *
 * @param override - Optional explicit config-file path (from CLI flag or test).
 * @param env - Optional environment override (defaults to `process.env`).
 * @returns A frozen, validated `MvpClawConfig`.
 * @throws If the file is missing, malformed JSON, or fails Zod validation.
 */
export function loadConfig(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): MvpClawConfigType {
  const path = resolveConfigPath(override);
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const substituted = substituteEnv(parsed, env);
  const config = MvpClawConfig.parse(substituted);
  return Object.freeze(config) as MvpClawConfigType;
}
