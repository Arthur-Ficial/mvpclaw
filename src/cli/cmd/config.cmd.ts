/**
 * `mvpclaw config` — get / set / validate / diff the SSOT config.
 *
 * Atomic writes: every `set` writes to a temp file, parses via Zod, and
 * only then renames to the target. A failed validation leaves the
 * original file untouched.
 */
import { defineCommand } from 'citty';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, MvpClawConfig, resolveConfigPath } from '../../config/index.js';
import { exitConfig, exitNotFound, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

/**
 * Drill into a JSON-ish object by dotted path. Returns `undefined` if
 * any segment is missing.
 */
function getByPath(obj: unknown, path: string): unknown {
  if (path.length === 0) {
    return obj;
  }
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Set a value at a dotted path on a deep clone of `obj`. Creates
 * intermediate objects as needed. Returns the new object.
 */
function setByPath(obj: unknown, path: string, value: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const parts = path.split('.');
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i] as string;
    if (cur[k] === null || typeof cur[k] !== 'object') {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
  return clone;
}

/** Try to coerce a string CLI value into a JSON-typed value (number/bool/JSON). */
function coerceValue(raw: string): unknown {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw === 'null') {
    return null;
  }
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  if (/^-?\d+\.\d+$/.test(raw)) {
    return Number(raw);
  }
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through — treat as string
    }
  }
  return raw;
}

const getCmd = defineCommand({
  meta: { name: 'get', description: 'Get the value at a dotted config path.' },
  args: {
    ...commonArgs,
    path: {
      type: 'positional',
      description: 'Dotted path (e.g. agent.provider).',
      required: false,
    },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const path = typeof args.path === 'string' ? args.path : '';
    const value = getByPath(config, path);
    if (path.length > 0 && value === undefined) {
      exitNotFound(`no value at path "${path}"`);
    }
    writeOut(value, ctx);
  },
});

const setCmd = defineCommand({
  meta: { name: 'set', description: 'Atomically set the value at a dotted config path.' },
  args: {
    ...commonArgs,
    path: { type: 'positional', description: 'Dotted path.', required: true },
    value: { type: 'positional', description: 'New value (auto-coerced or JSON).', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const configPath = resolveConfigPath(typeof args.config === 'string' ? args.config : undefined);
    if (!existsSync(configPath)) {
      exitConfig(`config file not found: ${configPath}`);
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      exitConfig(
        `config file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const updated = setByPath(raw, String(args.path), coerceValue(String(args.value)));
    // Validate via Zod BEFORE writing.
    const result = MvpClawConfig.safeParse(updated);
    if (!result.success) {
      exitUsage(
        `validation failed at ${String(args.path)}: ${result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    const tmpPath = join(dirname(configPath), `.mvpclaw-config.${process.pid}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    try {
      renameSync(tmpPath, configPath);
    } catch (err) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // already gone
      }
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    writeOut({ ok: true, path: String(args.path), value: coerceValue(String(args.value)) }, ctx);
  },
});

const validateCmd = defineCommand({
  meta: { name: 'validate', description: 'Validate the SSOT config file. Exit 2 on failure.' },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    try {
      const config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
      writeOut({ ok: true, provider: config.agent.provider }, ctx);
    } catch (err) {
      writeOut({ ok: false, error: err instanceof Error ? err.message : String(err) }, ctx);
      process.exit(2);
    }
  },
});

const diffCmd = defineCommand({
  meta: {
    name: 'diff',
    description: 'Show keys in the active config that differ from the example.',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const configPath = resolveConfigPath(typeof args.config === 'string' ? args.config : undefined);
    const example = readFileSync('mvpclaw.config.example.json', 'utf8');
    const active = readFileSync(configPath, 'utf8');
    const eParsed = JSON.parse(example) as Record<string, unknown>;
    const aParsed = JSON.parse(active) as Record<string, unknown>;
    writeOut({ activePath: configPath, differences: diffObjects(eParsed, aParsed, '') }, ctx);
  },
});

/** Recursive shallow-key diff: lists `path: example -> active` for changed leaves. */
function diffObjects(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  prefix: string,
): Array<{ path: string; from: unknown; to: unknown }> {
  const out: Array<{ path: string; from: unknown; to: unknown }> = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    const path = prefix.length === 0 ? k : `${prefix}.${k}`;
    if (
      av &&
      bv &&
      typeof av === 'object' &&
      typeof bv === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(bv)
    ) {
      out.push(...diffObjects(av as Record<string, unknown>, bv as Record<string, unknown>, path));
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      out.push({ path, from: av, to: bv });
    }
  }
  return out;
}

export const configCmd = defineCommand({
  meta: { name: 'config', description: 'Get / set / validate / diff the SSOT config.' },
  args: { ...commonArgs },
  subCommands: { get: getCmd, set: setCmd, validate: validateCmd, diff: diffCmd },
});
