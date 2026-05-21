/**
 * `mvpclaw status` — runtime introspection.
 *
 * Reports the configured provider, DB row counts, and a one-line summary
 * of which channels and providers are wired. Secret VALUES never appear
 * in the output — only presence (`Yes` / `No`).
 */
import { defineCommand } from 'citty';
import { MessagesRepo } from '../../db/index.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { withAppContext } from '../with-context.js';
import { commonArgs } from './_common.js';

export const statusCmd = defineCommand({
  meta: {
    name: 'status',
    description: 'Show configured provider, DB stats, channels, and key presence.',
  },
  args: { ...commonArgs },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    await withAppContext(args, (built) => {
      const config = built.ctx.config;
      const count = (sql: string): number => (built.ctx.db.prepare(sql).get() as { c: number }).c;
      const tg = MessagesRepo.messageStats(built.ctx.db, 'telegram');
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
          telegram: {
            received: tg.received,
            sent: tg.sent,
            total: tg.total,
            lastMessageAt: tg.lastAt,
          },
          counts: {
            chats: count('SELECT COUNT(*) AS c FROM chats'),
            messages: count('SELECT COUNT(*) AS c FROM messages'),
            agent_runs: count('SELECT COUNT(*) AS c FROM agent_runs'),
            outbox_pending: count("SELECT COUNT(*) AS c FROM outbox WHERE status='pending'"),
            outbox_sent: count("SELECT COUNT(*) AS c FROM outbox WHERE status='sent'"),
          },
        },
        ctx,
      );
    });
  },
});
