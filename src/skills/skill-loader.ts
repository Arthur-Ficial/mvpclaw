/**
 * Skill loader — scan `skillsDir` at boot, validate each `SKILL.md`,
 * upsert into the `skills` table, and return the in-memory list.
 *
 * The function is synchronous and idempotent: a second call re-scans
 * the directory and produces a fresh array. The DB upsert is a
 * straightforward INSERT-OR-REPLACE keyed by `name`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LoadedSkill } from '../agent/index.js';
import type { Db } from '../db/index.js';
import { validateSkillFile } from './skill-validator.js';

/** One bad-skill record reported by `loadSkillsFromDir()`. */
export interface LoadedSkillError {
  path: string;
  reason: string;
}

/** Outcome of one scan pass. */
export interface SkillLoadResult {
  /** Successfully validated + indexed skills. */
  skills: LoadedSkill[];
  /** Skill files that failed validation (with reasons). */
  errors: LoadedSkillError[];
}

/**
 * Scan a directory for `<name>/SKILL.md` files and return the validated set.
 *
 * The expected directory layout is `skillsDir/<name>/SKILL.md` per skill.
 * Sub-directories that lack a `SKILL.md` are silently ignored. Files
 * whose frontmatter is malformed are returned in `errors`, not thrown.
 *
 * @param skillsDir - The skills root directory.
 * @param db - Open SQLite handle (the function upserts each valid skill).
 * @returns A `SkillLoadResult` with the in-memory skill list + per-file errors.
 */
export function loadSkillsFromDir(skillsDir: string, db: Db): SkillLoadResult {
  const result: SkillLoadResult = { skills: [], errors: [] };
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    // No skills/ dir at all is OK.
    return result;
  }
  const upsert = db.prepare(
    `INSERT INTO skills (name, path, description, enabled, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(name) DO UPDATE SET
       path = excluded.path,
       description = excluded.description,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  );
  for (const dir of entries) {
    const dirPath = join(skillsDir, dir);
    let st;
    try {
      st = statSync(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      continue;
    }
    const skillPath = join(dirPath, 'SKILL.md');
    let raw;
    try {
      raw = readFileSync(skillPath, 'utf8');
    } catch {
      continue; // no SKILL.md → not a skill folder
    }
    const validated = validateSkillFile(raw);
    if (!validated.ok) {
      result.errors.push({ path: skillPath, reason: validated.error });
      continue;
    }
    if (validated.name !== dir) {
      result.errors.push({
        path: skillPath,
        reason: `frontmatter name "${validated.name}" does not match folder name "${dir}"`,
      });
      continue;
    }
    const absPath = resolve(skillPath);
    upsert.run(validated.name, absPath, validated.description, new Date().toISOString());
    result.skills.push({
      name: validated.name,
      description: validated.description,
      path: absPath,
      enabled: true,
    });
  }
  return result;
}
