/**
 * `mvpclaw doctor` — health check.
 *
 * P1 / C1 stub: prints a single "skeleton OK" line (proves the pipeline of
 * config-load → stdout-write works). Full health-check arrives in P10 (#16):
 * Node version, env vars present, claude --version, DB reachable, migrations
 * up to date, MCP servers spawnable, Telegram getMe.
 */
import { defineCommand } from 'citty';
import { loadConfig } from '../../config/index.js';
import { exitConfig } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const doctorCmd = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Health check — verifies the install is wired correctly.',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    try {
      const config = loadConfig(args.config);
      const checks = [
        { name: 'config', ok: true, detail: `provider=${config.agent.provider}` },
        { name: 'node', ok: process.versions.node >= '24', detail: `v${process.versions.node}` },
      ];
      writeOut({ ok: checks.every((c) => c.ok), checks }, ctx);
    } catch (e) {
      exitConfig(e instanceof Error ? e.message : String(e));
    }
  },
});
