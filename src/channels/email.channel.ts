/**
 * Email channel — turns a himalaya-backed inbox into a `ChannelAdapter`, so new
 * mail flows into the bot like Telegram. Polls `transport.listNew()` every
 * `pollIntervalSec`, maps each new envelope to an `InboundMessage`, then marks
 * it seen. Outbound `send()` goes back out via SMTP (himalaya).
 *
 * Multiplatform: no OS-specific calls — only the injectable transport (himalaya)
 * and timers. Shutdown is abortable so `stop()` returns promptly even mid-sleep.
 *
 * NOTE: the inbound text carries Subject + From (envelope headers); the agent
 * reads the full body on demand via the email skill. Mark-seen happens right
 * after enqueue; the rare crash-before-persist window is covered by Message-ID
 * dedup downstream (and the unseen-flag limitation is accepted — see the spec).
 */
import { ulid } from 'ulid';
import type { EmailTransport } from '../email/index.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from './channel.js';

/** The `email.channel` config block this adapter needs. */
export interface EmailChannelConfig {
  enabled: boolean;
  account: string;
  ownAddress: string;
  pollIntervalSec: number;
}

/** Test seam: an injectable sleep (defaults to a real, abort-aware timer). */
export interface EmailChannelDeps {
  sleep?: (ms: number) => Promise<void>;
}

/** Email channel adapter — also exposes `stop()` for clean shutdown. */
export interface EmailChannelAdapter extends ChannelAdapter {
  stop(): Promise<void>;
}

/**
 * Build the email channel adapter.
 *
 * @param config - The `email.channel` config block.
 * @param transport - The himalaya transport (injectable; no network in tests).
 * @param deps - Optional injectable sleep.
 * @returns An {@link EmailChannelAdapter}.
 */
export function createEmailChannel(
  config: EmailChannelConfig,
  transport: EmailTransport,
  deps: EmailChannelDeps = {},
): EmailChannelAdapter {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const buffer: InboundMessage[] = [];
  let waiter: ((value: IteratorResult<InboundMessage>) => void) | null = null;
  let started = false;
  let stopped = false;

  function enqueue(msg: InboundMessage): void {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w({ value: msg, done: false });
    } else {
      buffer.push(msg);
    }
  }

  function toInbound(env: {
    uid: string;
    messageId: string;
    from: string;
    subject: string;
    date: string;
  }): InboundMessage {
    return {
      id: 'email:' + ulid(),
      channel: 'email',
      providerUpdateId: env.messageId,
      providerChatId: env.from,
      providerUserId: env.from,
      text: `Subject: ${env.subject}\nFrom: ${env.from}\n\n(email — use the email skill to read the full body)`,
      receivedAt: env.date.length > 0 ? env.date : new Date().toISOString(),
      raw: env,
    };
  }

  async function pollLoop(): Promise<void> {
    while (!stopped) {
      try {
        const fresh = transport.listNew(config.account, config.ownAddress);
        const uids: string[] = [];
        for (const env of fresh) {
          enqueue(toInbound(env));
          uids.push(env.uid);
        }
        if (uids.length > 0) {
          transport.markSeen(config.account, uids);
        }
      } catch (err) {
        process.stderr.write(
          `email: poll failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      await sleep(config.pollIntervalSec * 1000);
    }
  }

  return {
    name: 'email',

    receive(): AsyncIterable<InboundMessage> {
      if (!started) {
        started = true;
        void pollLoop();
      }
      return {
        [Symbol.asyncIterator](): AsyncIterator<InboundMessage> {
          return {
            next(): Promise<IteratorResult<InboundMessage>> {
              const buffered = buffer.shift();
              if (buffered !== undefined) {
                return Promise.resolve({ value: buffered, done: false });
              }
              if (stopped) {
                return Promise.resolve({ value: undefined as never, done: true });
              }
              return new Promise<IteratorResult<InboundMessage>>((resolve) => {
                waiter = resolve;
              });
            },
          };
        },
      };
    },

    send(msg: OutboundMessage): Promise<SendResult> {
      transport.send(config.account, msg.providerChatId, 'Re: mvpclaw', msg.text, msg.replyTo);
      return Promise.resolve({ providerMessageId: null });
    },

    stop(): Promise<void> {
      stopped = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ value: undefined as never, done: true });
      }
      return Promise.resolve();
    },
  };
}
