/**
 * The `ChannelAdapter` interface — the single contract every chat surface
 * (Telegram, the CLI-injection channel, future Discord/Slack/voice) must
 * implement.
 *
 * Per `ARCHITECTURE.md` §1bis: the router, orchestrator, and outbox import
 * ONLY from `src/channels/`. No `grammy` (or any other channel SDK) symbol
 * leaks past this boundary. The `cli-inject` channel is real — it just
 * receives its `InboundMessage`s from the CLI instead of a network socket.
 */

/** Direction of a stored message — used by the `messages` table. */
export type Direction = 'inbound' | 'outbound';

/** A normalized inbound message produced by any channel adapter. */
export interface InboundMessage {
  /** Channel-name + project-scoped unique id (e.g. `telegram:01JABC...`). */
  id: string;
  /** Channel name (`"telegram"`, `"cli-inject"`, `"discord"`, …). */
  channel: string;
  /** External update id from the channel. Used for dedup. */
  providerUpdateId: string;
  /** External chat id (e.g. Telegram chat_id). */
  providerChatId: string;
  /** External thread id, when the channel supports threads (Telegram topics). */
  providerThreadId?: string | undefined;
  /** External user id (or synthetic for cli-inject). */
  providerUserId: string;
  /** Optional username (Telegram `@handle`). */
  providerUsername?: string | undefined;
  /** Plain text body of the message. */
  text: string;
  /** ISO 8601 UTC timestamp when the channel adapter observed the message. */
  receivedAt: string;
  /** Raw channel payload, retained for debugging / replay. */
  raw?: unknown;
}

/** An outbound message — what the bot wants to send to a channel. */
export interface OutboundMessage {
  /** Outbox row id (project ULID). */
  id: string;
  /** Channel to send via. */
  channel: string;
  /** External chat id. */
  providerChatId: string;
  /** External thread id, when applicable. */
  providerThreadId?: string | undefined;
  /** Message kind (`"text"`, future: `"edit"`, `"reaction"`, etc.). */
  kind: string;
  /** Plain text body. */
  text: string;
  /** Optional: existing message id to edit instead of sending a new one. */
  replyTo?: string | undefined;
}

/**
 * Result returned by `ChannelAdapter.send()`.
 *
 * @remarks
 * Most channels return a `providerMessageId` — the id assigned by the
 * external system, used later for edits or reactions. The `cli-inject`
 * channel returns `null` (it has no external system to forward to).
 */
export interface SendResult {
  /** Provider-assigned message id, or `null` for adapters that don't have one. */
  providerMessageId: string | null;
}

/**
 * The contract every channel implementation satisfies.
 *
 * @remarks
 * Adapters are responsible for:
 *   - normalising channel-specific payloads → `InboundMessage`
 *   - exposing an `AsyncIterable<InboundMessage>` via `receive()` so the
 *     orchestrator can `for await` over inbound traffic without knowing
 *     which channel produced it
 *   - sending `OutboundMessage`s out — `send()` for normal traffic; the
 *     adapter MAY also implement message-edit and other channel-specific
 *     verbs via additional methods OUTSIDE this base contract
 *   - never accessing SQLite or business logic — adapters are pure I/O
 */
export interface ChannelAdapter {
  /** Channel name. Stable; used as the foreign-side of stored rows. */
  readonly name: string;

  /**
   * Yield `InboundMessage`s as they arrive at the channel.
   *
   * Adapters are expected to block on the underlying transport (long-poll,
   * webhook queue, synthetic-injection promise). Callers iterate with
   * `for await`; calling `receive()` twice MAY share a single underlying
   * source — adapters document this individually.
   */
  receive(): AsyncIterable<InboundMessage>;

  /**
   * Send an `OutboundMessage` to the channel.
   *
   * @param msg - The outbound message.
   * @returns A `SendResult` with the provider-assigned message id (or null).
   * @throws If the channel rejects the send (rate limit, blocked user, etc.).
   */
  send(msg: OutboundMessage): Promise<SendResult>;
}
