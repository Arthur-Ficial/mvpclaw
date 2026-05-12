/**
 * Inbound router — the first thing every InboundMessage hits after the
 * channel adapter.
 *
 * Responsibilities:
 *   1. Resolve / upsert the chat (`chats`) and session (`sessions`) rows.
 *   2. Insert the inbound message (`messages`, direction='inbound').
 *   3. Dedup: an `InboundMessage` whose `providerUpdateId` was already
 *      seen produces NO new run (the UNIQUE constraint on
 *      `messages(provider, provider_update_id)` is the source of truth;
 *      the router checks before invoking the orchestrator so the agent
 *      doesn't run twice).
 *   4. Hand the resolved triple `(chat, session, message)` to the
 *      orchestrator for the actual agent run.
 *
 * Slash-command dispatch lives here too (recognising `/start`, `/help`,
 * `/status`, `/new`, `/skills`); the orchestrator only sees non-command
 * traffic. Per the spec, command handlers do NOT call the model.
 */
import type { InboundMessage } from '../channels/index.js';
import {
  ChatsRepo,
  MessagesRepo,
  OutboxRepo,
  SessionsRepo,
  type ChatRow,
  type Db,
  type MessageRow,
  type SessionRow,
} from '../db/index.js';
import { parseSlashCommand } from '../channels/telegram.commands.js';

/** The triple the orchestrator receives. */
export interface ResolvedInbound {
  chat: ChatRow;
  session: SessionRow;
  message: MessageRow;
  /** True if the inbound was a dedup hit (no new agent_run should be started). */
  isDuplicate: boolean;
  /** True if the message was a built-in slash command, already handled by the router. */
  isHandledCommand: boolean;
}

/**
 * Route a single inbound message: resolve chat/session, dedup, and (when
 * the message is a built-in command) enqueue the outbox reply directly.
 *
 * @param db - Open SQLite handle.
 * @param msg - The normalised `InboundMessage` from the channel adapter.
 * @returns A `ResolvedInbound` with `isDuplicate` / `isHandledCommand` flags.
 */
export function routeInbound(db: Db, msg: InboundMessage): ResolvedInbound {
  // 1. Upsert chat.
  const chat = ChatsRepo.upsertChat(db, {
    provider: msg.channel,
    provider_chat_id: msg.providerChatId,
    thread_id: msg.providerThreadId ?? null,
    type: 'private',
  });

  // 2. Resolve active session (create if needed).
  let session = SessionsRepo.getOrCreateActiveSession(db, chat.id);

  // 3. Insert inbound (dedup on UNIQUE constraint).
  const inserted = MessagesRepo.insertMessage(db, {
    session_id: session.id,
    direction: 'inbound',
    provider: msg.channel,
    provider_update_id: msg.providerUpdateId,
    sender_id: msg.providerUserId,
    text: msg.text,
    raw_json: msg.raw === undefined ? null : JSON.stringify(msg.raw),
  });
  const isDuplicate = !inserted.inserted;

  // 4. Slash-command dispatch — only built-ins are handled here.
  let isHandledCommand = false;
  if (!isDuplicate) {
    const parsed = parseSlashCommand(msg.text);
    if (parsed) {
      const reply = handleBuiltinCommand(parsed.command);
      if (reply !== null) {
        // /new resets the session BEFORE the reply is enqueued.
        if (parsed.command === 'new') {
          SessionsRepo.closeActiveSessions(db, chat.id);
          session = SessionsRepo.getOrCreateActiveSession(db, chat.id);
        }
        OutboxRepo.enqueueOutbox(db, {
          chat_id: chat.id,
          run_id: null,
          provider: msg.channel,
          provider_chat_id: msg.providerChatId,
          provider_thread_id: msg.providerThreadId ?? null,
          kind: 'text',
          text: reply,
        });
        isHandledCommand = true;
      }
    }
  }

  return { chat, session, message: inserted.row, isDuplicate, isHandledCommand };
}

/**
 * Map a built-in command name to a static reply string, or `null` if the
 * command is not built-in (the orchestrator will then route it as a skill
 * invocation or regular message).
 *
 * @param command - The lowercased command name (no leading slash).
 * @returns A reply string for built-in commands, or `null` otherwise.
 */
function handleBuiltinCommand(command: string): string | null {
  switch (command) {
    case 'start':
      return "Hi! I'm MVPClaw. Send me a message and I'll do my best to help. Commands: /help, /status, /new, /skills.";
    case 'help':
      return [
        'Available commands:',
        '/start — show this greeting',
        '/help — show this message',
        '/status — show the configured provider',
        '/new — start a fresh conversation in this chat',
        '/skills — list available skills',
      ].join('\n');
    case 'status':
      return 'Status: online. Provider details available via the CLI: `mvpclaw status`.';
    case 'new':
      return "New session started. Previous messages won't be sent to the model in future turns.";
    case 'skills':
      return 'Skills: research, debugging. Invoke a skill by prefixing your message with /skill-name.';
    default:
      return null;
  }
}
