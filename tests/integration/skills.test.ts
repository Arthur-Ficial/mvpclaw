import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, openDb } from '../../src/db/index.js';
import {
  loadSkillsFromDir,
  syncSkillsToWorkspace,
  validateSkillFile,
} from '../../src/skills/index.js';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

describe('skills layer — validate, load, sync', () => {
  it('validateSkillFile accepts a well-formed SKILL.md', () => {
    const raw = `---\nname: research\ndescription: Do sourced research.\n---\n\nBody here.\n`;
    const result = validateSkillFile(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe('research');
      expect(result.description).toBe('Do sourced research.');
      expect(result.body).toBe('Body here.');
    }
  });

  it('validateSkillFile rejects missing required keys', () => {
    const raw = `---\nname: research\n---\n\nbody\n`;
    const result = validateSkillFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('description');
    }
  });

  it('validateSkillFile rejects names with uppercase or underscores', () => {
    const cases = ['Research', 'my_skill', '0-leading', 'with space'];
    for (const name of cases) {
      const raw = `---\nname: ${name}\ndescription: d\n---\nbody`;
      const result = validateSkillFile(raw);
      expect(result.ok, `should reject "${name}"`).toBe(false);
    }
  });

  it('loadSkillsFromDir indexes valid skills + reports invalid ones', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-skills-load-'));
    try {
      mkdirSync(join(tmp, 'good'), { recursive: true });
      mkdirSync(join(tmp, 'bad-frontmatter'), { recursive: true });
      mkdirSync(join(tmp, 'mismatched-name'), { recursive: true });
      writeFileSync(
        join(tmp, 'good', 'SKILL.md'),
        `---\nname: good\ndescription: A good skill.\n---\nbody`,
      );
      writeFileSync(join(tmp, 'bad-frontmatter', 'SKILL.md'), `body without frontmatter`);
      writeFileSync(
        join(tmp, 'mismatched-name', 'SKILL.md'),
        `---\nname: notmatching\ndescription: d\n---\nbody`,
      );
      const db = openDb(':memory:');
      applyMigrations(db, MIGRATIONS);
      const result = loadSkillsFromDir(tmp, db);
      expect(result.skills.map((s) => s.name)).toEqual(['good']);
      expect(result.errors.length).toBe(2);
      // skills table reflects the upsert.
      const row = db.prepare('SELECT * FROM skills WHERE name = ?').get('good') as {
        name: string;
        description: string;
      };
      expect(row.description).toBe('A good skill.');
      db.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('syncSkillsToWorkspace copies and is idempotent', () => {
    const src = mkdtempSync(join(tmpdir(), 'mvpclaw-skills-src-'));
    const dst = mkdtempSync(join(tmpdir(), 'mvpclaw-skills-dst-'));
    try {
      mkdirSync(join(src, 'alpha'), { recursive: true });
      writeFileSync(join(src, 'alpha', 'SKILL.md'), `---\nname: alpha\ndescription: A.\n---\nbody`);
      const r1 = syncSkillsToWorkspace(src, dst);
      expect(r1.copied.length).toBe(1);
      expect(r1.skipped.length).toBe(0);
      // Second sync — mtime equal → skipped.
      const r2 = syncSkillsToWorkspace(src, dst);
      expect(r2.copied.length).toBe(0);
      expect(r2.skipped.length).toBe(1);
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(dst, { recursive: true, force: true });
    }
  });
});
