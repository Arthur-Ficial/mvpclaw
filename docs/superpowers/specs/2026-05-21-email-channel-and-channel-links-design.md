# Email as a Channel + Configurable Channel Links — Design

Date: 2026-05-21
Status: Draft for review
Scope: **DESIGN ONLY** — no implementation in this pass.
Repo: `Arthur-Ficial/mvpclaw` (public)

## 1. Purpose

Make email a first-class **channel** (unattended/reactive, like Telegram) in
addition to the existing on-demand **skill**, and let the bot treat email and
Telegram as **one conversation** via a configurable channel-linking mechanism.

The motivating sentence from the owner: *"single-thread bot — everything in one
thread; email knows of Telegram and the other way round."* Today the bot keys a
session to a single `(provider, chat_id)` chat, so email would otherwise become
its own isolated conversation. This design adds **channel links** so selected
identities share one session, and keeps that behavior off by default for
everyone except explicitly linked identities.

## 2. Current State (as explored 2026-05-21)

- `ChannelAdapter` (`src/channels/channel.ts`) is the I/O contract: `receive():
  AsyncIterable<InboundMessage>`, `send(OutboundMessage): SendResult`, optional
  `typing()`. Adapters never touch SQLite or business logic. Telegram and
  `cli-inject` implement it.
- Sessions are **per-chat**: `getOrCreateActiveSession(db, chatId)`; a chat is
  `(provider, provider_chat_id)`. There is no cross-chat / cross-channel thread.
- `messages` rows already carry a `provider` column and `direction`
  (`inbound`/`outbound`), so one session CAN hold mixed-channel messages.
- Email today is only `skills/email/SKILL.md` — the agent shells out to
  `himalaya` on demand. No email channel, no poller.
- `himalaya` v1.1.0 (`+imap +smtp`) is available; `envelope list --query
  "unseen since:<…>" -o json` supports incremental new-mail detection, which is
  the technical basis for a poll-based channel.

## 3. Decisions (locked with the owner)

- **D1 — Channel links, configurable.** A config-declared set of link groups;
  each group's member identities share ONE session. Default config links the
  owner's Telegram chat + the owner's email address into a single thread.
  Unlinked chats keep their own separate sessions.
- **D2 — Agent decides the reply channel per message.** The agent sees which
  channel each inbound came from and has every linked member's `send()` path; it
  chooses email vs Telegram per reply.
- **D3 — The email channel reuses the skill's `himalaya` transport.** The
  channel does NOT add a raw IMAP/SMTP library or a second credential store: it
  drives the same `himalaya` binary the skill documents (poll via `envelope
  list`, send via `message send`). The skill stays for on-demand work and for
  accounts that are not the live channel.
- **D4 — Design only now.** Produce + review this spec; do not implement yet.

## 4. Architecture

### 4.1 Shared email transport (`src/email/transport.ts`)
A small, injectable module wrapping the `himalaya` CLI with three operations the
channel needs: `listNew(account, sinceCursor)`, `send(account, to, subject,
body, inReplyTo?)`, `markSeen(account, ids)`. Every call shells `himalaya` via an
injectable exec function (so tests pass a fake — no network). Credentials are
himalaya's own (`himalaya account configure`), shared with the skill. This is the
concrete answer to "can the channel use the skill?": both ride this one wrapper /
the same binary + cred store.

### 4.2 Email channel (`src/channels/email.channel.ts`)
Implements `ChannelAdapter`:
- `receive()`: an async generator that polls `transport.listNew()` every
  `email.channel.pollIntervalSec`, maps each new envelope → `InboundMessage`,
  marks it seen, and yields it. Loop-safe: only INBOX, skip messages whose
  `From` is the bot's own account (never re-ingest a reply the bot just sent).
- `send()`: `transport.send()` (SMTP via himalaya); returns the sent Message-ID
  as `providerMessageId`.
- `name = "email"`.

### 4.3 InboundMessage mapping (dedup is the subtle part)
`providerUpdateId` MUST be the email **`Message-ID` header**, NOT himalaya's
per-session numeric envelope id (which is not stable across sessions). The
existing `messages(provider, provider_update_id)` UNIQUE constraint then gives
correct dedup. `providerChatId` = the configured email account (or sender
address — see §5 open question). `text` = subject + plain-text body (HTML
stripped); `raw` retains the envelope JSON.

### 4.4 Channel links + session resolution (the core change)
- New SSOT config `links`: a list of groups `{ id, members: [{channel, id}] }`.
- A pure function `resolveThreadKey(chat, links) → string`: if the chat's
  `(provider, providerChatId)` is a member of a link group, return that group's
  id; otherwise return the chat's own id. This is the testable heart of the
  feature.
- `inbound-router` calls `resolveThreadKey` and resolves the session by **thread
  key** instead of strictly by chat. Implementation approach: a link group has a
  designated **primary chat**; linked members' sessions resolve to the primary
  chat's session row (preserves the `sessions.chat_id` FK without a schema
  migration). Messages stored under that session keep their own `provider`, so
  the unified thread interleaves Telegram + email naturally.

### 4.5 Outbound addressing
Each link member entry carries its channel + address, so the agent (or the
orchestrator on its behalf) can target any linked channel. The outbox row already
has `channel` + `providerChatId`; the agent picks them per reply (D2). For email
replies, `inReplyTo` is threaded from the inbound Message-ID when available.

### 4.6 Config (SSOT additions)
- `email.channel`: `{ enabled (default false), account, pollIntervalSec (default
  120), ownAddress }` — account/ownAddress drive himalaya + the self-mail filter.
  (The existing `email` skill block stays.)
- `links`: `[{ id, members: [{ channel, id }], primary }]` — default ships a
  commented example linking `telegram` + `email` for the owner; empty/disabled by
  default until the owner fills real ids.
- `mvpclaw doctor` already reports `himalaya` presence; extend it to note when the
  email channel is enabled but himalaya/account is unconfigured.

## 5. Data Flow

```
IMAP inbox ──himalaya poll──▶ EmailChannel.receive() ──InboundMessage(channel=email)──▶
  inbound-router ──resolveThreadKey(chat, links)──▶ owner link-group session
  ──▶ orchestrator turn (context = interleaved telegram + email messages)
  ──▶ agent chooses reply channel ──▶ outbox(channel) ──▶ Telegram.send() OR EmailChannel.send()
```

## 6. Error Handling / Safety

- Poll failure (himalaya error, network) → log + continue; never crash the loop.
- **Self-mail loop guard**: skip inbound whose `From` == `email.channel.ownAddress`.
- Email channel disabled (default) → zero behavior change; existing installs
  unaffected.
- himalaya not configured while channel enabled → channel logs a clear "configure
  himalaya account X" warning and yields nothing; `doctor` surfaces it.
- Link misconfiguration must never merge a stranger into the owner thread: only
  exact `(channel, id)` matches join a group.

## 7. Testing (TDD)

- `resolveThreadKey` — pure unit tests: member→group id, non-member→own id,
  multiple groups, empty links.
- `email transport` — inject a fake `himalaya` exec; assert the argv for
  list/send/markSeen and the envelope→InboundMessage mapping (incl. Message-ID as
  providerUpdateId, self-mail skip).
- `email.channel` — drive `receive()` with a fake transport yielding two
  envelopes (one self-sent → filtered); assert one InboundMessage out.
- Router link integration — inbound from a linked email + a linked telegram chat
  land in the SAME session; an unlinked chat does not.
- No real IMAP/SMTP in any test (project policy: real plumbing only via opt-in,
  network-guarded tests).

## 8. Out of Scope (YAGNI)

- Real IMAP IDLE push (poll only this pass).
- Per-email-thread sessions, attachments beyond text, HTML rendering.
- A schema migration for sessions (the primary-chat approach avoids it).
- Auto-replying without the agent (the agent always decides — D2).

## 9. Open Questions (resolve during spec review / before plan)

1. **Email `providerChatId` granularity** — per *account* (all mail for an
   account = one identity) or per *sender address* (each correspondent = its own
   identity)? Account-level is simpler and matches the "owner thread" default;
   sender-level enables linking specific people. Lean: **account-level** for v1.
2. **Poll cursor persistence** — track "last seen" via himalaya's `unseen` flag
   (mark-seen after ingest) vs a stored timestamp cursor. Lean: **unseen flag**
   (simplest, himalaya-native), accepting that a human reading mail elsewhere
   also clears unseen.

## 10. Success Criteria

1. With the email channel enabled + a himalaya account configured, a new INBOX
   message produces exactly one `InboundMessage` (deduped by Message-ID), and the
   bot's own sent mail is never re-ingested.
2. A linked Telegram chat and the linked email address share one session; the
   agent's context contains both; an unlinked chat stays isolated.
3. The agent can reply to an inbound email via Telegram or via email, its choice.
4. Email channel disabled by default → no behavior change for existing installs.
5. `resolveThreadKey` + transport + channel mapping are unit-tested with no
   network; `pnpm check` green.
