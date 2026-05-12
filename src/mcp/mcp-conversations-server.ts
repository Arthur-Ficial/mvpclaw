/**
 * Internal MCP server: `mvpclaw-conversations`.
 *
 * Exposes read-only conversation introspection: list chats, read messages,
 * inspect a session, list recent agent runs. Used by AI clients that want
 * to inspect their own activity without going through the human CLI.
 */
import { loadConfig } from '../config/index.js';
import { applyMigrations, openDb, pathFromUrl } from '../db/index.js';
import { runMcpServer, type McpServerTool } from './mcp-server.js';
import {
  ChatsRepo,
  MessagesRepo,
  RunsRepo,
  SessionsRepo,
  type Db,
} from '../db/index.js';

/**
 * Build the conversation-introspection tool list. Read-only: no mutation
 * tools exposed here (use `mvpclaw-tools` for mutation via memory/task).
 *
 * @param db - Open SQLite handle.
 * @returns An MCP tool list.
 */
export function buildConversationsToolsList(db: Db): McpServerTool[] {
  return [
    {
      name: 'list_chats',
      description: 'List recent chats by updated_at descending.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', default: 20 } },
      },
      async call(input) {
        const args = (input ?? {}) as { limit?: number };
        const rows = ChatsRepo.listChats(db, args.limit ?? 20);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(rows) }],
        };
      },
    },
    {
      name: 'read_recent_messages',
      description: 'Read recent messages for a session (chronological).',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          limit: { type: 'number', default: 20 },
        },
        required: ['session_id'],
      },
      async call(input) {
        const args = input as { session_id: string; limit?: number };
        const rows = MessagesRepo.recentMessages(db, args.session_id, args.limit ?? 20);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(rows) }],
        };
      },
    },
    {
      name: 'get_active_session',
      description: 'Get (or create) the active session for a chat id.',
      inputSchema: {
        type: 'object',
        properties: { chat_id: { type: 'string' } },
        required: ['chat_id'],
      },
      async call(input) {
        const args = input as { chat_id: string };
        const session = SessionsRepo.getOrCreateActiveSession(db, args.chat_id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(session) }],
        };
      },
    },
    {
      name: 'list_recent_runs',
      description: 'List recent agent_runs.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', default: 20 } },
      },
      async call(input) {
        const args = (input ?? {}) as { limit?: number };
        const rows = db
          .prepare('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?')
          .all(args.limit ?? 20);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(rows) }],
        };
      },
    },
    {
      name: 'get_run',
      description: 'Fetch a single agent_runs row by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      async call(input) {
        const args = input as { id: string };
        const run = RunsRepo.findRunById(db, args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(run ?? null) }],
        };
      },
    },
  ];
}

/** Entry point: `mvpclaw mcp serve mvpclaw-conversations`. */
export async function runMvpClawConversationsServer(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const db = openDb(pathFromUrl(config.database.url));
  applyMigrations(db, 'migrations');
  try {
    await runMcpServer({
      info: { name: 'mvpclaw-conversations', version: '0.3.0' },
      tools: buildConversationsToolsList(db),
    });
  } finally {
    db.close();
  }
}
