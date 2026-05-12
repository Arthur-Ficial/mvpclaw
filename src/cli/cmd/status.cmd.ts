/**
 * `mvpclaw status` — current configured provider, DB stats, MCP reachability.
 *
 * P1 / C1 stub: reports the configured provider and Node version. Full
 * implementation arrives in P10 (#16): DB row counts, MCP server list,
 * key presence (never values).
 */
import { defineCommand } from 'citty';
import { loadConfig } from '../../config/index.js';
import { exitConfig } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const statusCmd = defineCommand({
  meta: {
    name: 'status',
    description: 'Show configured provider, DB stats, MCP reachability.',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    try {
      const config = loadConfig(args.config);
      writeOut(
        {
          provider: config.agent.provider,
          node: process.versions.node,
          dataDir: config.app.dataDir,
          workspaceDir: config.app.workspaceDir,
          telegramConfigured: process.env[config.telegram.tokenEnv] ? 'Yes' : 'No',
          openrouterConfigured: process.env[config.openrouter.apiKeyEnv] ? 'Yes' : 'No',
        },
        ctx,
      );
    } catch (e) {
      exitConfig(e instanceof Error ? e.message : String(e));
    }
  },
});
