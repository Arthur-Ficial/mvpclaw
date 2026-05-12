#!/usr/bin/env tsx
/**
 * Pre-lint script — every `src/<area>/` directory that contains TypeScript
 * source files must have an `index.ts` whose first non-trivial token is a
 * JSDoc block. That block is the area overview (1–3 scannable sentences).
 *
 * Exits 0 if every area is documented; exits 1 with a structured stderr
 * message naming each violation.
 *
 * This is the "source code IS the documentation" enforcement layer that
 * complements `eslint-plugin-jsdoc` / `eslint-plugin-tsdoc` — those rules
 * cover individual exports; this one covers whole folders.
 *
 * Wired into `package.json` `lint` script.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '..', 'src');

interface Violation {
  area: string;
  reason: string;
}

/**
 * Walk the immediate sub-directories of `src/` and report any that lack a
 * properly-documented `index.ts`.
 *
 * @returns An array of violations; empty when every area is documented.
 */
function findViolations(): Violation[] {
  const violations: Violation[] = [];
  const entries = readdirSync(SRC, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const areaPath = join(SRC, entry.name);
    // Only require an overview if the area actually contains .ts files.
    const hasTs = readdirSync(areaPath, { withFileTypes: true }).some(
      (f) => f.isFile() && f.name.endsWith('.ts'),
    );
    if (!hasTs) {
      continue;
    }
    const indexPath = join(areaPath, 'index.ts');
    let body: string;
    try {
      body = readFileSync(indexPath, 'utf8');
    } catch {
      violations.push({ area: entry.name, reason: `missing src/${entry.name}/index.ts` });
      continue;
    }
    // The first non-whitespace tokens must be a JSDoc block (`/** ... */`).
    const trimmed = body.replace(/^(﻿)?(\s|\/\/[^\n]*\n)*/, '');
    if (!trimmed.startsWith('/**')) {
      violations.push({
        area: entry.name,
        reason: `src/${entry.name}/index.ts does not start with a /** JSDoc overview block`,
      });
      continue;
    }
    // Find the closing */, then make sure the block has at least one prose line.
    const closeIdx = trimmed.indexOf('*/');
    if (closeIdx < 0) {
      violations.push({
        area: entry.name,
        reason: `src/${entry.name}/index.ts JSDoc block is unterminated`,
      });
      continue;
    }
    const inside = trimmed.slice(3, closeIdx);
    // Strip leading "*" from each line; require at least 10 non-whitespace chars.
    const prose = inside
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (prose.length < 10) {
      violations.push({
        area: entry.name,
        reason: `src/${entry.name}/index.ts JSDoc overview is too short (need >= 10 chars of prose)`,
      });
    }
  }
  return violations;
}

const violations = findViolations();

// In `cli` (which only re-exports), we also accept a file-top non-export
// JSDoc block on main.ts. This script chooses the strict path: every area
// has its own index.ts overview. `src/cli/` does need one.
if (violations.length === 0) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, areasChecked: '∀ src/<area>/' }));
  process.exit(0);
}
process.stderr.write(`mvpclaw: area-overviews: ${violations.length} violation(s)\n`);
for (const v of violations) {
  process.stderr.write(`  - ${v.area}: ${v.reason}\n`);
}
process.exit(1);
