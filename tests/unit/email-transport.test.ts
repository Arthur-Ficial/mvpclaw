/**
 * Email transport tests — drive the himalaya wrapper with a FAKE runner that
 * records argv and returns fixtures. No network. The fixture JSON encodes the
 * assumed `himalaya -o json` shapes; the real shape must be validated against a
 * configured himalaya account (network-opt-in) before production use.
 */
import { describe, it, expect } from 'vitest';
import { createEmailTransport } from '../../src/email/transport.js';

interface Call {
  cmd: string;
  args: string[];
  input?: string | undefined;
}

/** A fake himalaya runner: records calls, returns queued stdout per call. */
function fakeRunner(outputs: string[]) {
  const calls: Call[] = [];
  let i = 0;
  const run = (cmd: string, args: string[], input?: string) => {
    calls.push({ cmd, args, input });
    const stdout = outputs[i] ?? '';
    i += 1;
    return { stdout, status: 0 };
  };
  return { run, calls };
}

const ENVELOPE_LIST_JSON = JSON.stringify([
  {
    id: '42',
    message_id: '<abc@example.com>',
    flags: [],
    subject: 'Hello there',
    from: { name: 'Alex', addr: 'alex@example.com' },
    date: '2026-05-21T08:00:00Z',
  },
  {
    id: '43',
    message_id: '<self@example.com>',
    flags: [],
    subject: 'My own sent copy',
    from: { name: 'Owner', addr: 'me@example.com' },
    date: '2026-05-21T08:01:00Z',
  },
]);

describe('email transport — listNew', () => {
  it('lists unseen, maps envelopes, filters self-sent mail', () => {
    const { run, calls } = fakeRunner([ENVELOPE_LIST_JSON]);
    const t = createEmailTransport(run);
    const out = t.listNew('work', 'me@example.com');

    // argv: himalaya envelope list -a work -o json not seen
    expect(calls[0]?.cmd).toBe('himalaya');
    expect(calls[0]?.args.slice(0, 6)).toEqual(['envelope', 'list', '-a', 'work', '-o', 'json']);
    expect(calls[0]?.args).toContain('not');
    expect(calls[0]?.args).toContain('seen');

    // self-sent (me@example.com) filtered out → only the one from Alex.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      uid: '42',
      messageId: '<abc@example.com>',
      from: 'alex@example.com',
      subject: 'Hello there',
    });
  });

  it('synthesizes a stable id when Message-ID is missing', () => {
    const noMsgId = JSON.stringify([
      { id: '7', subject: 'No id', from: { addr: 'x@example.com' }, date: '2026-05-21T09:00:00Z' },
    ]);
    const { run } = fakeRunner([noMsgId]);
    const out = createEmailTransport(run).listNew('work', 'me@example.com');
    expect(out[0]?.messageId).toBe('work:7:2026-05-21T09:00:00Z');
  });
});

describe('email transport — send (two spawns, piped via stdin)', () => {
  it('writes a template then sends it via stdin (no shell pipe)', () => {
    const { run, calls } = fakeRunner(['RAW TEMPLATE TEXT', '']);
    createEmailTransport(run).send('work', 'to@example.com', 'Subj', 'Body text');

    // step 1: template write ... → stdout captured
    expect(calls[0]?.args.slice(0, 2)).toEqual(['template', 'write']);
    expect(calls[0]?.args).toContain('-a');
    // step 2: message send, fed the template via stdin
    expect(calls[1]?.args.slice(0, 2)).toEqual(['message', 'send']);
    expect(calls[1]?.input).toBe('RAW TEMPLATE TEXT');
  });

  it('threads In-Reply-To when replying', () => {
    const { run, calls } = fakeRunner(['T', '']);
    createEmailTransport(run).send('work', 'to@example.com', 'Re: x', 'Body', '<orig@example.com>');
    expect(calls[0]?.args.join(' ')).toContain('In-Reply-To:<orig@example.com>');
  });
});

describe('email transport — markSeen', () => {
  it('adds the seen flag to the given uids', () => {
    const { run, calls } = fakeRunner(['']);
    createEmailTransport(run).markSeen('work', ['42', '43']);
    expect(calls[0]?.args.slice(0, 2)).toEqual(['flag', 'add']);
    expect(calls[0]?.args).toContain('seen');
    expect(calls[0]?.args).toContain('42');
    expect(calls[0]?.args).toContain('43');
  });
});
