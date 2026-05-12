import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..', 'src');

/**
 * Recursively list every .ts file under `dir`.
 */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...tsFilesUnder(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * P3 / C2 channel-isolation invariant — the channel-adapter boundary holds.
 *
 * Business-logic areas (`app`, `agent`, `scheduler`, `mcp`, `skills`,
 * `prompts`, `memory`) must never import `grammy`. The orchestrator
 * speaks only `InboundMessage` / `OutboundMessage` (from
 * `src/channels/channel.ts`); the channel implementations own all
 * channel-specific SDK code.
 *
 * This test scans every .ts file in the business-logic areas and asserts
 * no line imports from `grammy`. If a future refactor accidentally pulls
 * a Telegram type into `src/app/`, this test fails — protecting the
 * "Telegram is one of N channels" architecture.
 */
describe('channel-isolation invariant', () => {
  it('no `grammy` import outside src/channels/', () => {
    const businessLogicAreas = ['app', 'agent', 'scheduler', 'mcp', 'skills', 'prompts', 'memory'];
    const violations: string[] = [];
    for (const area of businessLogicAreas) {
      const areaDir = join(SRC, area);
      let files: string[];
      try {
        files = tsFilesUnder(areaDir);
      } catch {
        continue; // area not present yet
      }
      for (const f of files) {
        const body = readFileSync(f, 'utf8');
        if (/from\s+['"]grammy['"]/.test(body) || /require\(['"]grammy['"]\)/.test(body)) {
          violations.push(f);
        }
      }
    }
    expect(
      violations,
      `channel-isolation broken: grammy imported in ${violations.join(', ')}`,
    ).toEqual([]);
  });

  it('every src/channels/<area> file is the only place grammy may appear', () => {
    // Scan the whole src/ tree and assert any grammy import is under src/channels/.
    const allFiles = tsFilesUnder(SRC);
    const offenders: string[] = [];
    for (const f of allFiles) {
      const body = readFileSync(f, 'utf8');
      if (/from\s+['"]grammy['"]/.test(body) || /require\(['"]grammy['"]\)/.test(body)) {
        if (!f.includes(`${SRC}/channels/`) && !f.includes(`${SRC}\\channels\\`)) {
          offenders.push(f);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
