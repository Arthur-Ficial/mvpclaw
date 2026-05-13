/**
 * Pure-function tests for `validateSkillFile`. Skill registration relies on
 * this validator to reject malformed SKILL.md files at load time — gaps
 * here surface only at runtime as "skill missing from list", which is much
 * harder to debug.
 */
import { describe, expect, it } from 'vitest';
import { validateSkillFile } from '../../src/skills/skill-validator.js';

function frontmatter(yaml: string, body = 'body'): string {
  return `---\n${yaml}\n---\n${body}`;
}

describe('validateSkillFile', () => {
  it('accepts a well-formed SKILL.md with name + description', () => {
    const r = validateSkillFile(
      frontmatter('name: my-skill\ndescription: Does a thing', '# Body content'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.name).toBe('my-skill');
      expect(r.description).toBe('Does a thing');
      expect(r.body).toBe('# Body content');
    }
  });

  it('trims surrounding whitespace from name and description', () => {
    const r = validateSkillFile(frontmatter('name: "  my-skill  "\ndescription: "  hello  "'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.name).toBe('my-skill');
      expect(r.description).toBe('hello');
    }
  });

  it('rejects missing name with a descriptive error', () => {
    const r = validateSkillFile(frontmatter('description: only desc'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/missing.*name/);
    }
  });

  it('rejects missing description', () => {
    const r = validateSkillFile(frontmatter('name: ok-name'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/missing.*description/);
    }
  });

  it('rejects an empty name (whitespace only)', () => {
    const r = validateSkillFile(frontmatter('name: "   "\ndescription: x'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/empty.*name|missing.*name/);
    }
  });

  it('rejects UPPERCASE name (must match [a-z][a-z0-9-]*)', () => {
    const r = validateSkillFile(frontmatter('name: MySkill\ndescription: x'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('must match');
    }
  });

  it('rejects name containing an underscore', () => {
    const r = validateSkillFile(frontmatter('name: my_skill\ndescription: x'));
    expect(r.ok).toBe(false);
  });

  it('rejects name containing a space', () => {
    const r = validateSkillFile(frontmatter('name: "my skill"\ndescription: x'));
    expect(r.ok).toBe(false);
  });

  it('rejects name starting with a digit', () => {
    const r = validateSkillFile(frontmatter('name: 1skill\ndescription: x'));
    expect(r.ok).toBe(false);
  });

  it('returns an error when input is empty', () => {
    const r = validateSkillFile('');
    expect(r.ok).toBe(false);
  });

  it('returns an error when input has body but no frontmatter', () => {
    const r = validateSkillFile('# Just a markdown body, no YAML frontmatter\n\nLorem.');
    expect(r.ok).toBe(false);
  });
});
