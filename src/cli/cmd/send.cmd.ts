/**
 * `mvpclaw send` — inject a synthetic InboundMessage through a channel adapter.
 *
 * The killer command. Pushes a synthetic message through the EXACT same
 * pipeline a real channel update would follow: router → orchestrator →
 * real provider → outbox → channel.send().
 *
 * Output is structured JSON when `--json` (or non-TTY); pretty-printed
 * when running in a terminal.
 *
 * @example
 * ```sh
 * # cli-inject channel — no Telegram required:
 * mvpclaw send --channel cli-inject --chat-id 1 --text "Say OK" --json
 *
 * # telegram channel — uses the configured TELEGRAM_BOT_TOKEN:
 * mvpclaw send --channel telegram --chat-id 12345 --user-id 67890 \
 *              --text "is this real?" --wait 30 --json
 *
 * # text from stdin:
 * echo "what's the weather?" | mvpclaw send --channel cli-inject --chat-id 1 --json
 * ```
 */
import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { ulid } from 'ulid';
import { buildAppContext, sendInjectedMessage } from '../../app/index.js';
import type { InboundMessage } from '../../channels/index.js';
import { loadConfig } from '../../config/index.js';
import { exitConfig, exitRuntime, exitTimeout, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

export const sendCmd = defineCommand({
  meta: {
    name: 'send',
    description: 'Inject a message via a channel adapter (the killer command).',
  },
  args: {
    ...commonArgs,
    channel: {
      type: 'string',
      description: 'Channel name (cli-inject, telegram, ...).',
      required: true,
    },
    'chat-id': {
      type: 'string',
      description: 'External chat id on the channel (Telegram chat_id, etc.).',
      required: true,
    },
    'user-id': {
      type: 'string',
      description: 'External user id. Default: synthetic CLI user.',
      default: 'cli-user',
    },
    username: {
      type: 'string',
      description: 'External username (Telegram @handle, etc.).',
      required: false,
    },
    text: {
      type: 'string',
      description: 'Message body. If omitted, read from stdin.',
      required: false,
    },
    'thread-id': {
      type: 'string',
      description: 'External thread/topic id, when the channel supports it.',
      required: false,
    },
    'update-id': {
      type: 'string',
      description: 'External update id. Default: auto-generated ULID. Use to test dedup.',
      required: false,
    },
    wait: {
      type: 'string',
      description: 'Max seconds to wait for the reply. Default 60.',
      default: '60',
    },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);

    // 1. Resolve the inbound text (flag or stdin).
    let text = typeof args.text === 'string' ? args.text : '';
    if (text.length === 0) {
      if (process.stdin.isTTY) {
        exitUsage('--text is required when stdin is a TTY');
      }
      try {
        text = readFileSync(0, 'utf8').trim();
      } catch (err) {
        exitUsage(
          `failed to read text from stdin: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (text.length === 0) {
        exitUsage('--text was empty and stdin produced no content');
      }
    }

    // 2. Load config + build wired context.
    let built;
    try {
      const config = loadConfig(args.config);
      built = buildAppContext(config);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }

    // 3. Verify the requested channel exists.
    const channelName = String(args['channel']);
    if (built.ctx.channels[channelName] === undefined) {
      exitConfig(
        `channel "${channelName}" is not wired — available: ${Object.keys(built.ctx.channels).join(', ')}`,
      );
    }

    // 4. Verify the configured provider is wired.
    const providerName = built.ctx.config.agent.provider;
    if (built.ctx.providers[providerName] === undefined) {
      exitConfig(
        `provider "${providerName}" is not wired — set its API key env var ` +
          `(see mvpclaw.config.json) or change agent.provider`,
      );
    }

    // 5. Build the InboundMessage and push it.
    const updateId =
      typeof args['update-id'] === 'string' ? args['update-id'] : `${channelName}-${ulid()}`;
    const inbound: InboundMessage = {
      id: `${channelName}:${ulid()}`,
      channel: channelName,
      providerUpdateId: updateId,
      providerChatId: String(args['chat-id']),
      providerUserId: String(args['user-id']),
      ...(typeof args['username'] === 'string' && args['username'].length > 0
        ? { providerUsername: args['username'] }
        : {}),
      ...(typeof args['thread-id'] === 'string' && args['thread-id'].length > 0
        ? { providerThreadId: args['thread-id'] }
        : {}),
      text,
      receivedAt: new Date().toISOString(),
    };

    // For cli-inject we also need to push into the channel's inject() so any
    // hypothetical consumer of `receive()` sees the message. For send-via-CLI
    // the orchestrator drives the flow directly from sendInjectedMessage.
    if (channelName === 'cli-inject') {
      built.cliInject.inject(inbound);
    }

    // 6. Run + drain, bounded by --wait.
    const waitSeconds = Number(args.wait);
    if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
      exitUsage(`--wait must be a non-negative number, got: ${args.wait}`);
    }
    const timeoutMs = waitSeconds * 1000;
    let outcome;
    try {
      outcome = await withTimeout(sendInjectedMessage(built.ctx, inbound), timeoutMs);
    } catch (err) {
      built.ctx.db.close();
      if (err instanceof TimeoutError) {
        exitTimeout(`no reply within ${waitSeconds}s`);
      }
      exitRuntime(err instanceof Error ? err.message : String(err));
    }

    // 7. Render result.
    built.ctx.db.close();
    writeOut(outcome, ctx);
    if (outcome.status === 'failed') {
      process.exit(3);
    }
  },
});

/** Lightweight timeout wrapper used only by the send command. */
class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms}ms`);
  }
}

/**
 * Await `promise` with a deadline. Resolves on success; rejects with a
 * `TimeoutError` if `ms` elapses first. `ms === 0` means no deadline.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
