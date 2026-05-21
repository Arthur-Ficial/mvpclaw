/**
 * Email channel tests — drive `receive()` with a FAKE transport and a
 * controllable sleep (no network, no timers). Verify envelope→InboundMessage
 * mapping, mark-seen-after-enqueue ordering, and prompt abortable shutdown.
 */
import { describe, it, expect } from 'vitest';
import { createEmailChannel } from '../../src/channels/email.channel.js';
import type { EmailEnvelope, EmailTransport } from '../../src/email/index.js';

const ENV: EmailEnvelope = {
  uid: '42',
  messageId: '<abc@example.com>',
  from: 'alex@example.com',
  subject: 'Hello there',
  date: '2026-05-21T08:00:00Z',
};

/** A fake transport: yields ENV once, then nothing; records markSeen + order. */
function fakeTransport() {
  const order: string[] = [];
  let listed = false;
  const t: EmailTransport = {
    listNew() {
      order.push('list');
      if (listed) {
        return [];
      }
      listed = true;
      return [ENV];
    },
    markSeen(_account, uids) {
      order.push('markSeen:' + uids.join(','));
    },
    send() {
      order.push('send');
    },
  };
  return { t, order };
}

/** A sleep that blocks until released (so the poll loop parks deterministically). */
function controllableSleep() {
  let release: (() => void) | null = null;
  const sleep = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  return { sleep, release: () => release?.() };
}

const cfg = { enabled: true, account: 'work', ownAddress: 'me@example.com', pollIntervalSec: 120 };

describe('email channel', () => {
  it('maps an envelope to an InboundMessage and marks it seen after enqueue', async () => {
    const { t, order } = fakeTransport();
    const { sleep } = controllableSleep();
    const ch = createEmailChannel(cfg, t, { sleep });

    const it = ch.receive()[Symbol.asyncIterator]();
    const first = await it.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      channel: 'email',
      providerUpdateId: '<abc@example.com>', // dedup by Message-ID
      providerChatId: 'alex@example.com', // per-sender identity
    });
    expect(first.value.text).toContain('Hello there');
    // mark-seen happens AFTER the message is enqueued.
    expect(order).toEqual(['list', 'markSeen:42']);

    await ch.stop();
  });

  it('stop() ends the iterator promptly even while the poll loop is sleeping', async () => {
    const { t } = fakeTransport();
    const { sleep } = controllableSleep();
    const ch = createEmailChannel(cfg, t, { sleep });

    const it = ch.receive()[Symbol.asyncIterator]();
    await it.next(); // consume ENV; loop then parks in sleep

    await ch.stop();
    const next = await it.next();
    expect(next.done).toBe(true);
  });

  it('send() delegates to the transport', async () => {
    const { t, order } = fakeTransport();
    const ch = createEmailChannel(cfg, t, { sleep: () => Promise.resolve() });
    await ch.send({
      id: 'o1',
      channel: 'email',
      providerChatId: 'to@example.com',
      kind: 'text',
      text: 'hi',
    });
    expect(order).toContain('send');
    await ch.stop();
  });
});
