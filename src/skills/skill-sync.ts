/**
 * Skill sync — copy validated skills into the runtime Claude Code
 * workspace at `~/.mvpclaw/workspaces/default/.claude/skills/`.
 *
 * Why: Claude CLI auto-discovers skills under `.claude/skills/<name>/SKILL.md`
 * relative to its working directory. Our source-of-truth lives in
 * `./skills/<name>/SKILL.md`. At boot we copy the source into the
 * workspace, so Claude CLI sees them without any flag plumbing.
 *
 * The sync is idempotent and mtime-aware: a file whose source mtime is
 * older than (or equal to) the destination's is left alone. This avoids
 * burning fs operations on every boot.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Outcome of one sync pass. */
export interface SkillSyncResult {
  /** Absolute destination directory (with `~` expanded). */
  destDir: string;
  /** Files newly written to (or refreshed in) the destination. */
  copied: string[];
  /** Files skipped because the destination was already up to date. */
  skipped: string[];
}

/**
 * Sync every `<name>/SKILL.md` under `sourceDir` into `destDir`.
 *
 * @param sourceDir - The repository's `skills/` directory (or test fixture).
 * @param destDir - Destination root. Supports a leading `~` for the home
 *                  directory; relative paths are resolved against cwd.
 * @returns The resolved `destDir`, plus the lists of files copied / skipped.
 */
export function syncSkillsToWorkspace(sourceDir: string, destDir: string): SkillSyncResult {
  const dest = expandHome(destDir);
  const result: SkillSyncResult = { destDir: dest, copied: [], skipped: [] };

  let entries: string[];
  try {
    entries = readdirSync(sourceDir);
  } catch {
    return result;
  }

  for (const name of entries) {
    const srcSkill = join(sourceDir, name, 'SKILL.md');
    let srcStat;
    try {
      srcStat = statSync(srcSkill);
    } catch {
      continue; // not a skill folder
    }
    if (!srcStat.isFile()) {
      continue;
    }
    const destSkill = join(dest, name, 'SKILL.md');
    mkdirSync(dirname(destSkill), { recursive: true });
    if (existsSync(destSkill)) {
      const destStat = statSync(destSkill);
      if (destStat.mtimeMs >= srcStat.mtimeMs) {
        result.skipped.push(destSkill);
        continue;
      }
    }
    copyFileSync(srcSkill, destSkill);
    result.copied.push(destSkill);
  }

  return result;
}

/** Expand a leading `~` to the user's home directory. */
function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}
