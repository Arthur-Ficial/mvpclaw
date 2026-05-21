/**
 * Skill validator — parses a `SKILL.md` file's YAML frontmatter and
 * confirms it has the two required keys: `name` and `description`.
 *
 * Pure function: takes raw file contents, returns either a valid
 * `LoadedSkill` minus the path, or a structured `ValidationError`.
 * The caller (the loader) wires in the path.
 */
import matter from 'gray-matter';

/** Outcome of `validateSkillFile()`. */
export type ValidationResult =
  | { ok: true; name: string; description: string; body: string; enabled: boolean }
  | { ok: false; error: string };

/** Required YAML frontmatter keys for a SKILL.md. */
const REQUIRED_KEYS = ['name', 'description'] as const;

/**
 * Validate the contents of a SKILL.md file.
 *
 * @param raw - Raw file contents (text + YAML frontmatter).
 * @returns A `ValidationResult` — either the parsed name+description+body,
 *          or `{ ok: false, error }` with a human-readable explanation.
 */
export function validateSkillFile(raw: string): ValidationResult {
  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    return {
      ok: false,
      error: `frontmatter parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const data = parsed.data as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (typeof data[key] !== 'string' || (data[key] as string).trim().length === 0) {
      return { ok: false, error: `missing or empty required frontmatter key: ${key}` };
    }
  }
  const name = (data['name'] as string).trim();
  const description = (data['description'] as string).trim();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return {
      ok: false,
      error: `name "${name}" must match [a-z][a-z0-9-]* (lowercase, no spaces, no underscores)`,
    };
  }
  // `enabled` is an optional frontmatter default; only an explicit `false`
  // disables. Config (skills.enabled/disabled) overrides this at load time.
  const enabled = data['enabled'] !== false;
  return { ok: true, name, description, body: parsed.content.trim(), enabled };
}
