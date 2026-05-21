/**
 * Email transport — a thin wrapper over the `himalaya` CLI (the SAME binary the
 * email skill drives). Used by the email channel for unattended poll + send.
 *
 * No raw IMAP/SMTP library and no second credential store: himalaya owns its own
 * account config. Every external call goes through an injectable runner so tests
 * pass a fake (no network). There is NO shell and NO pipe — himalaya's
 * `template write | message send` pipe is modelled as two `spawnSync` calls
 * chained via stdin.
 *
 * NOTE: the `-o json` shapes parsed here are the documented assumption; validate
 * them against a real configured himalaya account (network-opt-in) before
 * trusting the channel in production — unit tests here use fixtures.
 */
import { spawnSync } from 'node:child_process';

/** Injectable himalaya runner. `input` is fed to the process via stdin. */
export type HimalayaRun = (
  cmd: string,
  args: string[],
  input?: string,
) => { stdout: string; status: number | null };

/** One new inbound mail the channel turns into an `InboundMessage`. */
export interface EmailEnvelope {
  /** himalaya's per-session envelope id (used for markSeen; NOT for dedup). */
  uid: string;
  /** Stable dedup key — the RFC `Message-ID`, or a synthesized fallback. */
  messageId: string;
  /** Sender address (the per-correspondent identity). */
  from: string;
  /** Subject line. */
  subject: string;
  /** ISO date string from the envelope. */
  date: string;
}

/** The transport surface the email channel depends on. */
export interface EmailTransport {
  /**
   * List unseen mail, minus self-sent (`ownAddress`). When `allowedFrom` is
   * non-empty, ONLY mail from those senders is returned (the owner allowlist).
   */
  listNew(account: string, ownAddress: string, allowedFrom?: string[]): EmailEnvelope[];
  send(account: string, to: string, subject: string, body: string, inReplyTo?: string): void;
  markSeen(account: string, uids: string[]): void;
}

/** Default runner: no-shell `spawnSync`, optional stdin. */
const defaultRun: HimalayaRun = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { stdout: r.stdout ?? '', status: r.status };
};

/** Shape of one element of `himalaya envelope list -o json` (assumed). */
interface RawEnvelope {
  id?: string | number;
  message_id?: string;
  subject?: string;
  from?: { addr?: string; name?: string } | string;
  date?: string;
}

/** Extract a sender address from himalaya's `from` field (object or string). */
function fromAddr(from: RawEnvelope['from']): string {
  if (typeof from === 'string') {
    return from;
  }
  return from?.addr ?? '';
}

/**
 * Parse `himalaya envelope list -o json` output into envelopes. Pure + defensive
 * so a shape drift degrades gracefully rather than throwing.
 *
 * @param json - Raw stdout from the list command.
 * @param account - Account name (for synthesizing a fallback Message-ID).
 * @returns Parsed envelopes (unfiltered).
 */
export function parseEnvelopeList(json: string, account: string): EmailEnvelope[] {
  let rows: RawEnvelope[];
  try {
    const parsed: unknown = JSON.parse(json);
    rows = Array.isArray(parsed) ? (parsed as RawEnvelope[]) : [];
  } catch {
    return [];
  }
  return rows.map((e) => {
    const uid = String(e.id ?? '');
    const date = e.date ?? '';
    return {
      uid,
      messageId:
        e.message_id && e.message_id.length > 0 ? e.message_id : `${account}:${uid}:${date}`,
      from: fromAddr(e.from),
      subject: e.subject ?? '',
      date,
    };
  });
}

/**
 * Build the email transport.
 *
 * @param run - Injectable himalaya runner (defaults to a no-shell spawnSync).
 * @returns An {@link EmailTransport}.
 */
export function createEmailTransport(run: HimalayaRun = defaultRun): EmailTransport {
  return {
    listNew(account, ownAddress, allowedFrom = []) {
      const r = run('himalaya', ['envelope', 'list', '-a', account, '-o', 'json', 'not', 'seen']);
      const all = parseEnvelopeList(r.stdout, account);
      // Self-mail loop guard: never re-ingest the bot's own sent copies.
      const notSelf = all.filter((e) => e.from !== ownAddress);
      // Owner allowlist: when set, react ONLY to mail from these senders.
      if (allowedFrom.length === 0) {
        return notSelf;
      }
      return notSelf.filter((e) => allowedFrom.includes(e.from));
    },
    send(account, to, subject, body, inReplyTo) {
      const headers = ['-H', `To:${to}`, '-H', `Subject:${subject}`];
      if (inReplyTo) {
        headers.push('-H', `In-Reply-To:${inReplyTo}`);
      }
      // Step 1: render a raw message template (prepends a correct From: header).
      const tmpl = run('himalaya', ['template', 'write', '-a', account, ...headers, body]);
      // Step 2: send the rendered template via stdin (NO shell pipe).
      run('himalaya', ['message', 'send', '-a', account], tmpl.stdout);
    },
    markSeen(account, uids) {
      if (uids.length === 0) {
        return;
      }
      run('himalaya', ['flag', 'add', '-a', account, ...uids, 'seen']);
    },
  };
}
