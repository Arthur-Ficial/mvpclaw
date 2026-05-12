/**
 * `mvpclaw outbox` — observe and steer outgoing messages.
 *
 * Sub-commands:
 *   - list                 — print the most recent outbox rows
 *   - tail [--follow]      — stream rows as they appear (one JSON line each)
 *   - peek <outbox-id>     — full row for one id
 *   - flush [--dry-run]    — force the worker to drain pending now
 *   - cancel <outbox-id>   — transition a pending row to 'cancelled'
 *
 * All commands honour the universal flags from `_common.ts` (--json,
 * --quiet, --verbose, --config). list / tail can filter by --chat-id and
 * --status.
 */
import { defineCommand } from 'citty';
import { buildAppContext, drainOutbox } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { OutboxRepo, type OutboxRow, type OutboxStatus } from '../../db/index.js';
import { exitConfig, exitNotFound, exitUsage } from '../exit.js';
import { resolveOutputContext, writeJsonLine, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

/** Re-usable: open the wired AppContext from CLI flags. */
function open(args: Record<string, unknown>): ReturnType<typeof buildAppContext> {
  try {
    const config = loadConfig(typeof args['config'] === 'string' ? args['config'] : undefined);
    return buildAppContext(config);
  } catch (err) {
    exitConfig(err instanceof Error ? err.message : String(err));
  }
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List recent outbox rows (most recent first).' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', description: 'Filter by internal chat id.', required: false },
    status: {
      type: 'string',
      description: 'Filter by status (pending|sending|sent|failed|retrying|cancelled).',
      required: false,
    },
    limit: { type: 'string', description: 'Max rows (default 20).', default: '20' },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const rows = OutboxRepo.listOutbox(built.ctx.db, {
        ...(typeof args['chat-id'] === 'string' ? { chat_id: args['chat-id'] } : {}),
        ...(typeof args.status === 'string' && args.status.length > 0
          ? { status: args.status as OutboxStatus }
          : {}),
        limit: Number(args.limit),
      });
      writeOut(rows.map(rowSummary), ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const peekCmd = defineCommand({
  meta: { name: 'peek', description: 'Show the full row for one outbox id.' },
  args: {
    ...commonArgs,
    id: { type: 'positional', description: 'Outbox row id.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = built.ctx.db.prepare('SELECT * FROM outbox WHERE id = ?').get(String(args.id)) as
        | OutboxRow
        | undefined;
      if (!row) {
        exitNotFound(`outbox row "${String(args.id)}" not found`);
      }
      writeOut(row, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const tailCmd = defineCommand({
  meta: { name: 'tail', description: 'Print recent outbox rows; with --follow, stream new ones.' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', required: false },
    limit: { type: 'string', default: '20' },
    follow: { type: 'boolean', description: 'Stream new rows as they appear.', default: false },
  },
  async run({ args }) {
    const built = open(args);
    const limit = Number(args.limit);
    try {
      const seed = OutboxRepo.listOutbox(built.ctx.db, {
        ...(typeof args['chat-id'] === 'string' ? { chat_id: args['chat-id'] } : {}),
        limit,
      });
      // tail without --follow: print newest-first, exit. With --follow:
      // print existing rows oldest-first as a baseline, then poll.
      if (!args.follow) {
        for (const row of seed) {
          writeJsonLine(rowSummary(row));
        }
        return;
      }
      // Print baseline in chronological order then poll for newer ids.
      for (const row of [...seed].reverse()) {
        writeJsonLine(rowSummary(row));
      }
      let lastId = seed[0]?.id ?? '';
      while (true) {
        await new Promise((r) => setTimeout(r, 250));
        const fresh = OutboxRepo.listOutbox(built.ctx.db, {
          ...(typeof args['chat-id'] === 'string' ? { chat_id: args['chat-id'] } : {}),
          limit: 50,
        }).filter((r) => r.id > lastId);
        for (const row of [...fresh].reverse()) {
          writeJsonLine(rowSummary(row));
        }
        if (fresh.length > 0) {
          const first = fresh[0];
          if (first !== undefined) {
            lastId = first.id;
          }
        }
      }
    } finally {
      built.ctx.db.close();
    }
  },
});

const flushCmd = defineCommand({
  meta: { name: 'flush', description: 'Force the outbox worker to drain pending rows now.' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', required: false },
    'dry-run': {
      type: 'boolean',
      description: 'List pending rows without sending.',
      default: false,
    },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      if (args['dry-run']) {
        const pending = OutboxRepo.listOutbox(built.ctx.db, {
          status: 'pending',
          ...(typeof args['chat-id'] === 'string' ? { chat_id: args['chat-id'] } : {}),
          limit: 100,
        });
        writeOut(
          { dryRun: true, pendingCount: pending.length, rows: pending.map(rowSummary) },
          ctx,
        );
        return;
      }
      const result = await drainOutbox(
        built.ctx,
        typeof args['chat-id'] === 'string' ? { chat_id: args['chat-id'] } : {},
      );
      writeOut(result, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const cancelCmd = defineCommand({
  meta: { name: 'cancel', description: "Mark a 'pending' outbox row as 'cancelled'." },
  args: {
    ...commonArgs,
    id: { type: 'positional', description: 'Outbox row id.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = built.ctx.db.prepare('SELECT * FROM outbox WHERE id = ?').get(String(args.id)) as
        | OutboxRow
        | undefined;
      if (!row) {
        exitNotFound(`outbox row "${String(args.id)}" not found`);
      }
      if (row.status === 'sent' || row.status === 'cancelled') {
        // Idempotent — already terminal.
        writeOut({ id: row.id, status: row.status, note: 'already terminal; no change' }, ctx);
        return;
      }
      if (row.status !== 'pending') {
        exitUsage(
          `cannot cancel a row in status "${row.status}" — only 'pending' rows can be cancelled`,
        );
      }
      OutboxRepo.markOutboxCancelled(built.ctx.db, row.id);
      writeOut({ id: row.id, status: 'cancelled' }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

export const outboxCmd = defineCommand({
  meta: {
    name: 'outbox',
    description: 'List / tail / peek / flush / cancel outgoing messages.',
  },
  args: { ...commonArgs },
  subCommands: {
    list: listCmd,
    tail: tailCmd,
    peek: peekCmd,
    flush: flushCmd,
    cancel: cancelCmd,
  },
});

/** Compact summary of an outbox row for human / JSON output. */
function rowSummary(r: OutboxRow): {
  id: string;
  chat: string;
  status: string;
  attempts: number;
  text: string;
  createdAt: string;
} {
  return {
    id: r.id,
    chat: r.chat_id,
    status: r.status,
    attempts: r.attempts,
    text: r.text.length > 60 ? r.text.slice(0, 57) + '…' : r.text,
    createdAt: r.created_at,
  };
}
