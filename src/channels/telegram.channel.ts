/**
 * Telegram channel adapter — a `ChannelAdapter` implementation backed by grammY.
 *
 * This is the ONLY place in the codebase allowed to import `grammy`. The
 * router, orchestrator, and outbox see only `InboundMessage` / `OutboundMessage`
 * (defined in `./channel.ts`).
 *
 * Responsibilities:
 *   - Open a long-poll connection to Telegram (webhook mode is config-driven
 *     and mutually exclusive; we currently implement long-poll only — the
 *     webhook path lands when an actual deployment needs it).
 *   - Normalise each `update.message` into our canonical `InboundMessage`.
 *   - Enforce reply-mode (DM-only / DM-and-mentioned-groups / all) and the
 *     allowlist (`telegram.allowedChatIds`, `allowedUserIds`).
 *   - Filter to text messages — voice/photo/file are out of scope (per spec).
 *   - Send outbound text via `bot.api.sendMessage`, auto-chunking through
 *     `chunkText` so each piece fits Telegram's 4096-char hard limit.
 *
 * Streaming-edit (one message edited every editIntervalMs) is exposed as a
 * dedicated method `sendStreamingReply` outside the `ChannelAdapter`
 * interface, because edit-while-streaming isn't a generic channel verb.
 * The orchestrator (P4) opts in to it for providers that yield deltas.
 */
import { Bot } from 'grammy';
import { ulid } from 'ulid';
import type { TelegramConfig } from '../config/config.schema.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from './channel.js';
import { chunkText } from './telegram.format.js';

/**
 * Construct a Telegram channel adapter.
 *
 * @param config - Resolved Telegram config block from `mvpclaw.config.json`.
 * @param env - Process env (for the bot token at `config.tokenEnv`).
 * @returns A `ChannelAdapter` ready for `receive()` / `send()`.
 * @throws If the configured token env var is missing or empty.
 */
export function createTelegramChannel(
  config: TelegramConfig,
  env: NodeJS.ProcessEnv = process.env,
): TelegramChannelAdapter {
  const token = env[config.tokenEnv];
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`telegram: env var ${config.tokenEnv} is required but is empty or unset`);
  }
  if (config.mode === 'webhook') {
    throw new Error(
      'telegram: webhook mode is not yet implemented — set telegram.mode to "polling"',
    );
  }

  const bot = new Bot(token);

  // ── Internal async queue plumbing for receive() ───────────────────────
  const buffer: InboundMessage[] = [];
  let waiter: ((value: IteratorResult<InboundMessage>) => void) | null = null;
  let started = false;

  function enqueue(msg: InboundMessage): void {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w({ value: msg, done: false });
    } else {
      buffer.push(msg);
    }
  }

  // ── Filtering: reply mode + allowlist + text-only ─────────────────────
  function passesFilters(ctx: GrammyMessageContext): boolean {
    const msg = ctx.message;
    if (!msg || typeof msg.text !== 'string') {
      return false; // text only
    }
    const userId = String(msg.from?.id ?? '');
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      return false;
    }
    const chatId = String(msg.chat.id);
    if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
      return false;
    }
    if (msg.chat.type !== 'private') {
      // Group / supergroup / channel — apply replyMode.
      if (config.replyMode === 'dm-only') {
        return false;
      }
      if (config.replyMode === 'dm-and-mentioned-groups') {
        const text = msg.text;
        const me = ctx.me.username ?? '';
        const mentioned = text.includes(`@${me}`);
        const isCommand = text.startsWith('/');
        if (!mentioned && !isCommand) {
          return false;
        }
      }
      // 'all' → no extra filter
    }
    return true;
  }

  // ── Normalise grammY context → InboundMessage ─────────────────────────
  function normalise(ctx: GrammyMessageContext): InboundMessage | null {
    const msg = ctx.message;
    if (!msg || typeof msg.text !== 'string') {
      return null;
    }
    const providerChatId = String(msg.chat.id);
    const providerUserId = String(msg.from?.id ?? '');
    const providerUpdateId = String(ctx.update.update_id);
    return {
      id: 'telegram:' + ulid(),
      channel: 'telegram',
      providerUpdateId,
      providerChatId,
      providerThreadId:
        typeof msg.message_thread_id === 'number' ? String(msg.message_thread_id) : undefined,
      providerUserId,
      providerUsername: msg.from?.username,
      text: msg.text,
      receivedAt: new Date(msg.date * 1000).toISOString(),
      raw: msg,
    };
  }

  bot.on('message', (ctx) => {
    const wrapped = ctx as unknown as GrammyMessageContext;
    if (!passesFilters(wrapped)) {
      return;
    }
    const inbound = normalise(wrapped);
    if (inbound) {
      enqueue(inbound);
    }
  });

  const adapter: TelegramChannelAdapter = {
    name: 'telegram' as const,

    receive(): AsyncIterable<InboundMessage> {
      if (!started) {
        started = true;
        // Start long-polling in the background; do not await.
        void bot.start({ drop_pending_updates: false }).catch((err: unknown) => {
          process.stderr.write(
            `telegram: bot.start() failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        });
      }
      return {
        [Symbol.asyncIterator](): AsyncIterator<InboundMessage> {
          return {
            next(): Promise<IteratorResult<InboundMessage>> {
              const buffered = buffer.shift();
              if (buffered !== undefined) {
                return Promise.resolve({ value: buffered, done: false });
              }
              return new Promise<IteratorResult<InboundMessage>>((resolve) => {
                waiter = resolve;
              });
            },
          };
        },
      };
    },

    async send(msg: OutboundMessage): Promise<SendResult> {
      const chunks = chunkText(msg.text, config.streaming.maxMessageChars);
      let lastMessageId: number | null = null;
      const threadId = msg.providerThreadId !== undefined ? Number(msg.providerThreadId) : null;
      for (const chunk of chunks) {
        const sent =
          threadId === null
            ? await bot.api.sendMessage(msg.providerChatId, chunk)
            : await bot.api.sendMessage(msg.providerChatId, chunk, {
                message_thread_id: threadId,
              });
        lastMessageId = sent.message_id;
      }
      return { providerMessageId: lastMessageId === null ? null : String(lastMessageId) };
    },

    async stop(): Promise<void> {
      if (started) {
        await bot.stop();
      }
      // Unblock a pending waiter so a polling consumer can exit cleanly.
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ value: undefined as never, done: true });
      }
    },
  };

  return adapter;
}

/**
 * Extended `ChannelAdapter` returned by `createTelegramChannel`. Exposes
 * `stop()` so the orchestrator's SIGTERM handler can shut polling down
 * cleanly. Future verbs (edit-message, streaming-edit) attach here too.
 */
export interface TelegramChannelAdapter extends ChannelAdapter {
  readonly name: 'telegram';
  /** Stop the long-poll loop and resolve any pending `receive()` waiter. */
  stop(): Promise<void>;
}

/**
 * The shape of a grammY message context our handler actually touches.
 *
 * We define it locally rather than importing grammY's `Context` so we can
 * make the surface area explicit (and so the type doesn't leak across
 * the channel boundary).
 */
interface GrammyMessageContext {
  message?: {
    text?: string;
    date: number;
    message_thread_id?: number;
    from?: { id: number; username?: string };
    chat: { id: number; type: string };
  };
  update: { update_id: number };
  me: { username?: string };
}
