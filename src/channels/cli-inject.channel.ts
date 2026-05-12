/**
 * The CLI-injection channel — a real `ChannelAdapter` whose inbound source
 * is the CLI itself.
 *
 * `mvpclaw send` (ticket C4) pushes synthetic `InboundMessage`s through
 * `inject()`. The orchestrator consumes them from `receive()` exactly as it
 * would consume a real Telegram update. This is NOT a fake provider — the
 * envelope, the pipeline, and every downstream side-effect are the same.
 * The channel just happens to take its input from the CLI process instead
 * of a network poll.
 *
 * `send()` writes to STDERR with a `cli-inject:` prefix so a CLI consumer
 * can see what the bot wanted to deliver. The CLI command that initiated
 * the inject usually reads the outbox separately to render the reply on
 * STDOUT — see ticket C4 for the user-facing flow.
 */
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from './channel.js';

/** Public surface of the cli-inject channel, including the push API. */
export interface CliInjectChannel extends ChannelAdapter {
  readonly name: 'cli-inject';
  /**
   * Push a synthetic `InboundMessage` into the channel's `receive()` stream.
   *
   * @param msg - The message to deliver. The orchestrator sees it on the
   *              next `for await` iteration.
   */
  inject(msg: InboundMessage): void;
}

/**
 * Build a fresh CLI-injection channel.
 *
 * @returns A `CliInjectChannel` with `name: "cli-inject"`. Each call returns
 *          an independent channel — use one per `AppContext`.
 */
export function createCliInjectChannel(): CliInjectChannel {
  // A simple async queue. Pending consumers wait on `nextResolve`; producers
  // either satisfy the waiter or buffer the message until a consumer arrives.
  const buffer: InboundMessage[] = [];
  let nextResolve: ((value: IteratorResult<InboundMessage>) => void) | null = null;

  const channel: CliInjectChannel = {
    name: 'cli-inject' as const,

    inject(msg: InboundMessage): void {
      if (nextResolve) {
        const resolve = nextResolve;
        nextResolve = null;
        resolve({ value: msg, done: false });
      } else {
        buffer.push(msg);
      }
    },

    receive(): AsyncIterable<InboundMessage> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<InboundMessage> {
          return {
            next(): Promise<IteratorResult<InboundMessage>> {
              const buffered = buffer.shift();
              if (buffered !== undefined) {
                return Promise.resolve({ value: buffered, done: false });
              }
              return new Promise<IteratorResult<InboundMessage>>((resolve) => {
                nextResolve = resolve;
              });
            },
          };
        },
      };
    },

    send(msg: OutboundMessage): Promise<SendResult> {
      // For cli-inject the "channel" has no external system to forward to.
      // We write the outbound text to stderr with a clear marker so a CLI
      // consumer can see what the bot wanted to send. STDOUT stays clean
      // (reserved for command results per output discipline).
      process.stderr.write(
        `cli-inject: send chat=${msg.providerChatId} text=${JSON.stringify(msg.text)}\n`,
      );
      return Promise.resolve({ providerMessageId: null });
    },
  };

  return channel;
}
