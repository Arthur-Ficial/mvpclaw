/**
 * Skills area — load, validate, and sync AgentSkills-format `SKILL.md`
 * files into both the in-memory `LoadedSkill[]` array (consumed by the
 * prompt builder + the `mvpclaw_list_skills` / `mvpclaw_read_skill`
 * built-in tools) and the runtime Claude Code workspace.
 *
 * Pure functions for parsing + validation; thin I/O for scan + sync.
 * No business logic about skill selection — that lives in the prompt
 * composer (P15).
 */
export { validateSkillFile } from './skill-validator.js';
export type { ValidationResult } from './skill-validator.js';
export { loadSkillsFromDir } from './skill-loader.js';
export type { SkillLoadResult, LoadedSkillError } from './skill-loader.js';
export { syncSkillsToWorkspace } from './skill-sync.js';
export type { SkillSyncResult } from './skill-sync.js';
