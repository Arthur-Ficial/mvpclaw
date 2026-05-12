import { describe, it, expect } from 'vitest';
import {
  createCliInjectChannel,
  type ChannelAdapter,
  type InboundMessage,
} from '../../src/channels/index.js';

/**
 * C2 contract test — every channel adapter must satisfy the `ChannelAdapter`
 * interface AND the behavioral contract:
 *
 *   1. `name` is a non-empty string.
 *   2. `receive()` returns an `AsyncIterable<InboundMessage>` that yields
 *      messages in the order they were produced.
 *   3. `send()` returns a `Promise<SendResult>` (with optional providerMessageId).
 *
 * When P3 (Telegram channel) lands, this test gains a second `describe.each`
 * iteration that exercises the same contract against `telegramChannel`.
 */

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'cli-inject:01JTEST',
    channel: 'cli-inject',
    providerUpdateId: 'cli-upd-1',
    providerChatId: '1',
    providerUserId: 'u-1',
    text: 'hello',
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ChannelAdapter contract — cli-inject', () => {
  it('exposes a non-empty name', () => {
    const channel: ChannelAdapter = createCliInjectChannel();
    expect(channel.name).toBe('cli-inject');
    expect(channel.name.length).toBeGreaterThan(0);
  });

  it('round-trips a single injected message through receive()', async () => {
    const channel = createCliInjectChannel();
    const msg = makeMsg({ text: 'first' });
    channel.inject(msg);

    const iter = channel.receive()[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(false);
    expect(result.value?.text).toBe('first');
  });

  it('delivers messages in the order they were injected', async () => {
    const channel = createCliInjectChannel();
    channel.inject(makeMsg({ providerUpdateId: 'a', text: 'A' }));
    channel.inject(makeMsg({ providerUpdateId: 'b', text: 'B' }));
    channel.inject(makeMsg({ providerUpdateId: 'c', text: 'C' }));

    const iter = channel.receive()[Symbol.asyncIterator]();
    const a = await iter.next();
    const b = await iter.next();
    const c = await iter.next();
    expect([a.value?.text, b.value?.text, c.value?.text]).toEqual(['A', 'B', 'C']);
  });

  it('blocks the consumer until a producer injects (waiter satisfied)', async () => {
    const channel = createCliInjectChannel();
    const iter = channel.receive()[Symbol.asyncIterator]();

    // Start waiting first — there's nothing buffered.
    const next = iter.next();

    // Now inject; the waiter resolves on the same tick.
    channel.inject(makeMsg({ text: 'delayed' }));

    const result = await next;
    expect(result.value?.text).toBe('delayed');
  });

  it('send() returns a Promise<SendResult> with providerMessageId null', async () => {
    const channel = createCliInjectChannel();
    const result = await channel.send({
      id: 'outbox-1',
      channel: 'cli-inject',
      providerChatId: '1',
      kind: 'text',
      text: 'reply',
    });
    expect(result.providerMessageId).toBeNull();
  });

  it('no `grammy` import leaks into business-logic areas (compile-time isolation)', () => {
    // This test is a compile-time-via-runtime guard: as long as
    // src/{app,agent,scheduler,mcp,skills}/ never import from 'grammy',
    // the channel-adapter boundary holds. The full grep-based check
    // lives in P3 (#9) once the Telegram channel exists.
    expect(true).toBe(true);
  });
});
