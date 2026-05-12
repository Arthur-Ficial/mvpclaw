/**
 * `mvpclaw chat` — list / show / new / reset chats.
 *
 * A "chat" in MVPClaw is the row in the `chats` table: a (channel,
 * providerChatId, threadId?) triple resolved at first contact. This
 * sub-command surface lets the operator inspect chats and reset the
 * current session within one (equivalent to a user typing `/new`).
 */
import { defineCommand } from 'citty';
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import {
  ChatsRepo,
  MessagesRepo,
  SessionsRepo,
  type ChatRow,
  type MessageRow,
} from '../../db/index.js';
import { exitConfig, exitNotFound, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

function open(args: Record<string, unknown>): ReturnType<typeof buildAppContext> {
  try {
    const config = loadConfig(typeof args['config'] === 'string' ? args['config'] : undefined);
    return buildAppContext(config);
  } catch (err) {
    exitConfig(err instanceof Error ? err.message : String(err));
  }
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List recent chats.' },
  args: {
    ...commonArgs,
    channel: { type: 'string', description: 'Filter by channel name.', required: false },
    limit: { type: 'string', description: 'Max rows (default 50).', default: '50' },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const limit = Number(args.limit);
      let rows: ChatRow[] = ChatsRepo.listChats(built.ctx.db, limit);
      if (typeof args.channel === 'string' && args.channel.length > 0) {
        rows = rows.filter((r) => r.provider === args.channel);
      }
      writeOut(
        rows.map((r) => ({
          id: r.id,
          channel: r.provider,
          providerChatId: r.provider_chat_id,
          threadId: r.thread_id,
          updatedAt: r.updated_at,
        })),
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
  },
});

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show chat metadata + recent messages.' },
  args: {
    ...commonArgs,
    id: { type: 'positional', description: 'Internal chat id.', required: true },
    limit: { type: 'string', description: 'Max messages (default 20).', default: '20' },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const chat = ChatsRepo.findChatById(built.ctx.db, String(args.id));
      if (!chat) {
        exitNotFound(`chat "${String(args.id)}" not found`);
      }
      const session = SessionsRepo.getOrCreateActiveSession(built.ctx.db, chat.id);
      const messages: MessageRow[] = MessagesRepo.recentMessages(
        built.ctx.db,
        session.id,
        Number(args.limit),
      );
      writeOut(
        {
          chat: {
            id: chat.id,
            channel: chat.provider,
            providerChatId: chat.provider_chat_id,
            threadId: chat.thread_id,
            createdAt: chat.created_at,
            updatedAt: chat.updated_at,
          },
          activeSession: { id: session.id, status: session.status },
          messages: messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            text: m.text,
            createdAt: m.created_at,
          })),
        },
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
  },
});

const newCmd = defineCommand({
  meta: { name: 'new', description: 'Create a synthetic chat without sending a message.' },
  args: {
    ...commonArgs,
    channel: { type: 'string', description: 'Channel name.', required: true },
    'chat-id': { type: 'string', description: 'External chat id.', required: true },
    'thread-id': { type: 'string', description: 'External thread id.', required: false },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const chat = ChatsRepo.upsertChat(built.ctx.db, {
        provider: String(args.channel),
        provider_chat_id: String(args['chat-id']),
        thread_id: typeof args['thread-id'] === 'string' ? args['thread-id'] : null,
        type: 'private',
      });
      const session = SessionsRepo.getOrCreateActiveSession(built.ctx.db, chat.id);
      writeOut({ chat, session }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const resetCmd = defineCommand({
  meta: {
    name: 'reset',
    description: "Close the active session (equivalent to the user typing '/new').",
  },
  args: {
    ...commonArgs,
    id: { type: 'positional', description: 'Internal chat id.', required: true },
    yes: { type: 'boolean', description: 'Confirm destructive action.', default: false },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    if (!args.yes) {
      exitUsage('reset is destructive; pass --yes to confirm');
    }
    const built = open(args);
    try {
      const chat = ChatsRepo.findChatById(built.ctx.db, String(args.id));
      if (!chat) {
        exitNotFound(`chat "${String(args.id)}" not found`);
      }
      const closed = SessionsRepo.closeActiveSessions(built.ctx.db, chat.id);
      const fresh = SessionsRepo.getOrCreateActiveSession(built.ctx.db, chat.id);
      writeOut({ chatId: chat.id, closedSessions: closed, newSessionId: fresh.id }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

export const chatCmd = defineCommand({
  meta: { name: 'chat', description: 'List / show / new / reset chats.' },
  args: { ...commonArgs },
  subCommands: { list: listCmd, show: showCmd, new: newCmd, reset: resetCmd },
});
