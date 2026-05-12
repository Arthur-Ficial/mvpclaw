/**
 * `mvpclaw status` — runtime introspection.
 *
 * Reports the configured provider, DB row counts, and a one-line summary
 * of which channels and providers are wired. Secret VALUES never appear
 * in the output — only presence (`Yes` / `No`).
 */
import { defineCommand } from 'citty';
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { exitConfig } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const statusCmd = defineCommand({
  meta: {
    name: 'status',
    description: 'Show configured provider, DB stats, channels, and key presence.',
  },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const built = buildAppContext(config);
    try {
      const counts = {
        chats: (built.ctx.db.prepare('SELECT COUNT(*) AS c FROM chats').get() as { c: number }).c,
        messages: (
          built.ctx.db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }
        ).c,
        agent_runs: (
          built.ctx.db.prepare('SELECT COUNT(*) AS c FROM agent_runs').get() as {
            c: number;
          }
        ).c,
        outbox_pending: (
          built.ctx.db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE status='pending'").get() as {
            c: number;
          }
        ).c,
        outbox_sent: (
          built.ctx.db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE status='sent'").get() as {
            c: number;
          }
        ).c,
      };
      writeOut(
        {
          provider: config.agent.provider,
          node: process.versions.node,
          dataDir: config.app.dataDir,
          workspaceDir: config.app.workspaceDir,
          channels: Object.keys(built.ctx.channels),
          providers: Object.keys(built.ctx.providers),
          telegramConfigured: process.env[config.telegram.tokenEnv] ? 'Yes' : 'No',
          openrouterConfigured: process.env[config.openrouter.apiKeyEnv] ? 'Yes' : 'No',
          counts,
        },
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
  },
});
