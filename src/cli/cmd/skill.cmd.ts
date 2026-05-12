/**
 * `mvpclaw skill` — list / show / validate / sync skills.
 *
 * Reads from the `skills/` directory configured in `mvpclaw.config.json`
 * (default `./skills`). The `validate` sub-command exits non-zero if any
 * skill fails frontmatter validation. The `invoke` sub-command lives in
 * ticket C9 (memory + skill agent invocations); for now this group covers
 * the read-only + sync verbs that the AI needs to introspect skills.
 */
import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { applyMigrations, openDb, type Db } from '../../db/index.js';
import { loadSkillsFromDir, syncSkillsToWorkspace, validateSkillFile } from '../../skills/index.js';
import { exitConfig, exitNotFound } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

function open(args: Record<string, unknown>): ReturnType<typeof buildAppContext> {
  try {
    const config = loadConfig(typeof args['config'] === 'string' ? args['config'] : undefined);
    return buildAppContext(config);
  } catch (err) {
    exitConfig(err instanceof Error ? err.message : String(err));
  }
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List loaded skills.' },
  args: {
    ...commonArgs,
    'enabled-only': { type: 'boolean', description: 'Skip disabled skills.', default: false },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      let skills = [...built.ctx.skills];
      if (args['enabled-only']) {
        skills = skills.filter((s) => s.enabled);
      }
      writeOut(
        skills.map((s) => ({ name: s.name, description: s.description, path: s.path })),
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
  },
});

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show a skill (metadata + full body).' },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Skill name.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const skill = built.ctx.skills.find((s) => s.name === String(args.name));
      if (!skill) {
        exitNotFound(`skill "${String(args.name)}" not found`);
      }
      const body = readFileSync(skill.path, 'utf8');
      writeOut({ name: skill.name, description: skill.description, path: skill.path, body }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const validateCmd = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate every SKILL.md frontmatter. Exit 1 on any error.',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    // Use a throwaway in-memory DB so validate doesn't write to the real one.
    const inMem = openInMemoryForLoad();
    try {
      const skillsDir = resolve(process.cwd(), config.skills.skillsDir);
      const result = loadSkillsFromDir(skillsDir, inMem);
      writeOut(
        {
          ok: result.errors.length === 0,
          skillsLoaded: result.skills.length,
          errors: result.errors,
        },
        ctx,
      );
      if (result.errors.length > 0) {
        process.exit(1);
      }
    } finally {
      inMem.close();
    }
  },
});

const syncCmd = defineCommand({
  meta: {
    name: 'sync',
    description: 'Sync skills/ → ~/.mvpclaw/workspaces/default/.claude/skills/',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const result = syncSkillsToWorkspace(
      resolve(process.cwd(), config.skills.skillsDir),
      config.skills.runtimeClaudeSkillsDir,
    );
    writeOut(result, ctx);
  },
});

const validateOneCmd = defineCommand({
  meta: {
    name: 'validate-file',
    description: 'Validate one SKILL.md path; useful for editor integrations.',
  },
  args: {
    ...commonArgs,
    path: { type: 'positional', description: 'Path to the SKILL.md file.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let raw;
    try {
      raw = readFileSync(String(args.path), 'utf8');
    } catch (err) {
      exitNotFound(err instanceof Error ? err.message : String(err));
    }
    const result = validateSkillFile(raw);
    writeOut(result, ctx);
    if (!result.ok) {
      process.exit(1);
    }
  },
});

export const skillCmd = defineCommand({
  meta: { name: 'skill', description: 'List / show / validate / sync AgentSkills.' },
  args: { ...commonArgs },
  subCommands: {
    list: listCmd,
    show: showCmd,
    validate: validateCmd,
    sync: syncCmd,
    'validate-file': validateOneCmd,
  },
});

/**
 * Open an in-memory SQLite for `skill validate` so we don't mutate the
 * real DB. Applies the migrations so the `skills` table exists.
 *
 * @returns An open in-memory DB handle ready for `loadSkillsFromDir`.
 */
function openInMemoryForLoad(): Db {
  const db = openDb(':memory:');
  applyMigrations(db, resolve(process.cwd(), 'migrations'));
  return db;
}
