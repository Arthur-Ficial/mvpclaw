/**
 * `mvpclaw agent` — direct agent runs without going through a channel.
 *
 * Three verbs:
 *   - run     — invoke the agent with --prompt + --chat-id; prints the reply
 *               directly to stdout. Bypasses outbox (no channel.send()).
 *   - replay  — re-run the prompt that produced an existing agent_runs row.
 *               Produces a NEW run with the same input_message_id.
 *   - dry-run — compose the prompt the orchestrator WOULD send and print it.
 *               Never invokes the provider. Useful for prompt iteration.
 */
import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import { ulid } from 'ulid';
import { buildAppContext, routeInbound, runAgentTurn, type AppContext } from '../../app/index.js';
import type { InboundMessage } from '../../channels/index.js';
import { loadConfig } from '../../config/index.js';
import { composePrompt, truncateHistory } from '../../prompts/index.js';
import {
  ChatsRepo,
  MessagesRepo,
  RunsRepo,
  type AgentRunRow,
  type MessageRow,
} from '../../db/index.js';
import { exitConfig, exitNotFound, exitRuntime, exitUsage } from '../exit.js';
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

/** Resolve --prompt; reads from `@filename` if prefixed; from stdin if missing and stdin is piped. */
function resolvePrompt(args: { prompt?: string }): string {
  let text = typeof args.prompt === 'string' ? args.prompt : '';
  if (text.startsWith('@')) {
    const path = text.slice(1);
    if (!existsSync(path)) {
      exitUsage(`--prompt file not found: ${path}`);
    }
    text = readFileSync(path, 'utf8');
  }
  if (text.length === 0) {
    if (process.stdin.isTTY) {
      exitUsage('--prompt is required when stdin is a TTY');
    }
    text = readFileSync(0, 'utf8').trim();
  }
  if (text.length === 0) {
    exitUsage('--prompt was empty and stdin produced no content');
  }
  return text;
}

const runCmd = defineCommand({
  meta: {
    name: 'run',
    description: 'Invoke the agent directly without going through a channel.',
  },
  args: {
    ...commonArgs,
    'chat-id': {
      type: 'string',
      description: 'Internal chat id (from `chat new` / `chat list`).',
      required: true,
    },
    prompt: {
      type: 'string',
      description: 'Prompt text or @path/to/file. Reads stdin if omitted.',
      required: false,
    },
    'channel-name': {
      type: 'string',
      description: 'Channel name to attribute (default cli-inject).',
      default: 'cli-inject',
    },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    const text = resolvePrompt({ prompt: typeof args.prompt === 'string' ? args.prompt : '' });
    const built = open(args);
    try {
      const chat = ChatsRepo.findChatById(built.ctx.db, String(args['chat-id']));
      if (!chat) {
        exitNotFound(`chat "${String(args['chat-id'])}" not found — use 'mvpclaw chat new' first`);
      }
      // Synthetic InboundMessage attributed to the chat's channel by default.
      const channelName = String(args['channel-name']);
      const inbound: InboundMessage = {
        id: `${channelName}:${ulid()}`,
        channel: channelName,
        providerUpdateId: `agent-run-${ulid()}`,
        providerChatId: chat.provider_chat_id,
        providerUserId: 'cli-agent',
        text,
        receivedAt: new Date().toISOString(),
      };
      const resolved = routeInbound(built.ctx.db, inbound);
      if (resolved.isHandledCommand) {
        // The text was a built-in slash command — orchestrator wasn't called.
        writeOut({ status: 'command', note: 'text resolved to a built-in slash command' }, ctx);
        return;
      }
      const result = await runAgentTurn(built.ctx, resolved);
      writeOut(result, ctx);
      if (result.status === 'failed') {
        process.exit(3);
      }
    } finally {
      built.ctx.db.close();
    }
  },
});

const replayCmd = defineCommand({
  meta: {
    name: 'replay',
    description: 'Re-run a stored agent_runs row. New run, same input_message_id.',
  },
  args: {
    ...commonArgs,
    id: { type: 'positional', description: 'agent_runs id to replay.', required: true },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const original: AgentRunRow | undefined = RunsRepo.findRunById(built.ctx.db, String(args.id));
      if (!original) {
        exitNotFound(`agent_runs id "${String(args.id)}" not found`);
      }
      // Fetch the original input message.
      const inputMessage = built.ctx.db
        .prepare('SELECT * FROM messages WHERE id = ?')
        .get(original.input_message_id) as MessageRow | undefined;
      if (!inputMessage) {
        exitRuntime(
          `replay: input_message_id "${original.input_message_id}" referenced by run "${String(args.id)}" does not exist`,
        );
      }
      // Re-route a synthetic inbound that uses the SAME inputMessage.text.
      // We don't go through routeInbound here because that would create a
      // new messages row; instead we directly run a new agent turn against
      // the existing message + session.
      const result = await runAgentTurnFromExisting(built.ctx, original, inputMessage);
      writeOut(result, ctx);
      if (result.status === 'failed') {
        process.exit(3);
      }
    } finally {
      built.ctx.db.close();
    }
  },
});

const dryRunCmd = defineCommand({
  meta: {
    name: 'dry-run',
    description: 'Compose the prompt the orchestrator WOULD send. Never calls the provider.',
  },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', description: 'Internal chat id.', required: true },
    prompt: {
      type: 'string',
      description: 'Prompt text or @path. Reads stdin if omitted.',
      required: false,
    },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const text = resolvePrompt({ prompt: typeof args.prompt === 'string' ? args.prompt : '' });
    const built = open(args);
    try {
      const chat = ChatsRepo.findChatById(built.ctx.db, String(args['chat-id']));
      if (!chat) {
        exitNotFound(`chat "${String(args['chat-id'])}" not found`);
      }
      const windowed = truncateHistory([], {
        windowMessages: built.ctx.config.idle.windowMessages,
        windowTokens: built.ctx.config.idle.windowTokens,
      });
      const out = composePrompt({
        systemPromptFile: built.ctx.config.agent.systemPromptFile,
        skills: built.ctx.skills,
        history: windowed.history,
        userText: text,
        chatId: chat.id,
        db: built.ctx.db,
        tools: built.ctx.tools,
      });
      writeOut(
        {
          chatId: chat.id,
          systemPrompt: out.systemPrompt,
          history: out.history,
          userText: out.userText,
          tools: out.tools,
          breakpoints: out.breakpoints,
          provider: built.ctx.config.agent.provider,
          model: built.ctx.config.openrouter.defaultModel,
        },
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
  },
});

export const agentCmd = defineCommand({
  meta: {
    name: 'agent',
    description: 'Direct agent runs (run / replay / dry-run); bypasses channel and outbox.',
  },
  args: { ...commonArgs },
  subCommands: { run: runCmd, replay: replayCmd, 'dry-run': dryRunCmd },
});

/**
 * Run an agent turn against an existing message + session, without going
 * through `routeInbound` (used by `agent replay` so we don't fabricate a
 * fresh inbound row).
 *
 * @param ctx - The application context.
 * @param original - The original agent_runs row being replayed.
 * @param inputMessage - The stored inbound message referenced by `original`.
 * @returns The new run's `AgentTurnResult`.
 */
async function runAgentTurnFromExisting(
  ctx: AppContext,
  original: AgentRunRow,
  inputMessage: MessageRow,
): Promise<import('../../app/index.js').AgentTurnResult> {
  // Build a fake ResolvedInbound out of the original triple. The orchestrator
  // doesn't care that the message already exists — it just uses the ids.
  const chat = ctx.db
    .prepare('SELECT * FROM chats WHERE id = (SELECT chat_id FROM sessions WHERE id = ?)')
    .get(original.session_id) as import('../../db/repos/chats.repo.js').ChatRow | undefined;
  const session = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(original.session_id) as
    | import('../../db/repos/sessions.repo.js').SessionRow
    | undefined;
  if (!chat || !session) {
    exitRuntime(`replay: chat/session for run "${original.id}" no longer exists`);
  }
  // Use the inputMessage row directly; it's just a typed shape.
  void MessagesRepo;
  return runAgentTurn(ctx, {
    chat,
    session,
    message: inputMessage,
    isDuplicate: false,
    isHandledCommand: false,
  });
}
