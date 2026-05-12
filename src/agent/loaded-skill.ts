/**
 * Minimal `LoadedSkill` shape — what the agent layer needs to know about a
 * loaded skill at run time.
 *
 * The full skill loader (P7, #13) populates this. The interface lives in the
 * agent area to avoid a circular import: the AgentProviderAdapter contract
 * needs the type, and the skills module wires the data.
 */
export interface LoadedSkill {
  /** Skill name (also the directory name under `skills/`). */
  name: string;
  /** Short description from the SKILL.md frontmatter. */
  description: string;
  /** Path on disk to the SKILL.md file (for forced-skill body reads). */
  path: string;
  /** Whether the skill is enabled in the active configuration. */
  enabled: boolean;
}
