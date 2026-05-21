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
  yields it, and only THEN marks it seen (durable-record-before-cursor — see
  §6). Loop-safe: only INBOX, skip messages whose `From` is the bot's own
  account (`email.channel.ownAddress`).
- **Abortable shutdown.** `start.cmd.ts` today stops inbound by setting a stop
  flag and `break`ing after the *next* yield; Telegram additionally exposes a
  `stop()` that resolves its pending waiter (`telegram.channel.ts`). A naive
  `await sleep(120s)` poll would delay shutdown by up to one interval. So the
  email channel MUST expose a `stop()` (mirroring Telegram) and use an
  **abortable sleep** that resolves immediately on stop; shutdown wiring in
  `start.cmd.ts` calls it. This is required, not optional.
- `send()`: `transport.send()` (SMTP via himalaya); returns the sent Message-ID
  as `providerMessageId`.
- `name = "email"`.

### 4.3 InboundMessage mapping (dedup + identity are the subtle parts)
- `providerUpdateId` MUST be the email **`Message-ID` header**, NOT himalaya's
  per-session numeric envelope id (which is not stable across sessions). The
  existing `messages(provider, provider_update_id)` UNIQUE constraint then gives
  correct dedup. **Null/missing Message-ID fallback:** `insertMessage` only
  dedups on a truthy `provider_update_id`, so a (rare but legal) missing
  Message-ID would re-ingest every poll. Fallback: synthesize a stable key from
  `account + uid + internal-date`; covered by a test.
- `providerChatId` = the **sender's `From` address** (per-correspondent
  identity), NOT the account. This is what keeps strangers isolated: a random
  sender becomes its own chat/session; only the owner's *own* address is in the
  link group (§4.4), so only the owner's mail joins the owner thread. (Resolves
  §9 Q1 — see the safety property in §6.)
- `text` = subject + plain-text body (HTML stripped); `raw` retains the envelope
  JSON.

### 4.4 Channel links + session resolution (the core change)
- New SSOT config `links`: a list of groups `{ id, primary: {channel, id},
  members: [{channel, id}] }`. The `primary` member is the chat whose session row
  the whole group shares.
- Pure function `resolvePrimaryChatRef(channel, providerChatId, links) →
  {channel, id}`: if the inbound identity is a member of a link group, return the
  group's `primary`; otherwise return the identity unchanged. This is the
  testable heart of the feature.
- **`inbound-router` must substitute the primary at EVERY session-scoped call
  site, not just lookup.** `routeInbound` does four things keyed on chat id, and
  they split into two buckets:
  - **Identity / dedup (uses the REAL inbound chat):** `upsertChat` and the
    `messages` dedup — so the email chat row + Message-ID dedup stay accurate.
  - **Thread-scoped (uses the PRIMARY chat):** `getOrCreateActiveSession`, the
    idle auto-reset gap check, and `/new` / `closeActiveSessions`. All three MUST
    operate on the primary chat id, or a linked email could reset/branch a
    different session than the one holding the thread.
  Messages keep their own `provider`, so the shared session interleaves Telegram
  + email naturally, and `messageStats(db, provider)` per-channel counts stay
  correct.
- **Accepted consequence (document, don't fix):** a linked email's own `chats`
  row exists for identity but no session points at it, so `mvpclaw chat show
  <email-chat>` shows zero messages — the content lives under the primary
  (Telegram) chat. This is intentional for the unified-thread model.
- **Alternative considered + rejected:** add a nullable `sessions.thread_key`
  column (one migration) and key sessions by thread_key. Cleaner in theory (no
  "session points at primary chat" indirection), but it adds a migration and a
  second session-lookup path; §8 keeps "no migration" as a goal and the
  primary-chat substitution is contained to `routeInbound`. Revisit if the
  substitution proves leaky in the plan phase.

### 4.5 Outbound: the reply-channel mechanism (D2 needs real code)
**Gap in the current code:** `agent-orchestrator.ts` hardcodes the outbox
`provider` + `provider_chat_id` to the *originating* chat — the reply always goes
back where the message came from. There is no way today for the agent to choose a
different channel. D2 therefore needs a concrete mechanism:

- **Default reply (unchanged):** the orchestrator's final-text reply still goes
  to the originating channel. For most turns that is exactly right.
- **Agent-directed cross-channel reply (new):** add an agent-callable tool
  `send_message({ channel, text })` (a builtin tool, gated by config) that
  enqueues an outbox row for a chosen **linked member** of the current thread's
  link group. The tool validates that `channel` is a member of the active
  thread's group (so the agent can only send to linked identities, never to an
  arbitrary address — preserves the §6 safety property), resolves that member's
  `providerChatId`, and writes the outbox row with that `provider` +
  `providerChatId`. For email, `inReplyTo` threads from the inbound Message-ID.
- This makes "agent decides reply channel per message" real and testable: a turn
  whose agent calls `send_message({channel:'email', ...})` produces an outbox row
  with `provider='email'` and the linked recipient.

(Without this tool, v1 would silently collapse to "reply on originating channel
only" — which contradicts D2, so the tool is in scope.)

### 4.6 Config (SSOT additions) + wiring
- `email.channel`: a NEW block, distinct from the existing skill `EmailConfig`
  (`config.schema.ts` — which has only `enabled/himalayaAccount/defaultPageSize`).
  Shape: `{ enabled (default false), account, pollIntervalSec (default 120),
  ownAddress }`. `account`/`ownAddress` drive himalaya + the self-mail filter.
- `links`: `[{ id, primary: {channel, id}, members: [{channel, id}] }]` — empty by
  default; ships a commented example linking the owner's `telegram` + `email`.
- **Wiring:** `build-app-context.ts` registers the email channel into
  `ctx.channels` ONLY when `email.channel.enabled` AND a himalaya account is
  configured (mirroring how Telegram is gated on `enabled` + token present).
  `start.cmd.ts` fans its `receive()` into the same inbound loop and calls its
  `stop()` on shutdown (§4.2).
- `mvpclaw doctor` already reports `himalaya` presence; extend it to warn when the
  email channel is enabled but himalaya/account is unconfigured.

## 5. Data Flow

```
IMAP inbox ──himalaya poll──▶ EmailChannel.receive() ──InboundMessage(channel=email, chatId=sender)──▶
  inbound-router ──resolvePrimaryChatRef(channel, sender, links)──▶ owner link-group (primary) session
  ──▶ orchestrator turn (context = interleaved telegram + email messages)
  ──▶ default reply → originating channel, OR agent calls send_message({channel})
  ──▶ outbox(channel) ──▶ Telegram.send() OR EmailChannel.send()
```

## 6. Error Handling / Safety

- Poll failure (himalaya error, network) → log + continue; never crash the loop.
- **Self-mail loop guard**: skip inbound whose `From` == `email.channel.ownAddress`
  (never re-ingest a reply the bot just sent via SMTP).
- **Stranger isolation (safety property).** Because the inbound email identity is
  the *sender address* (§4.3) and only the owner's own address is a link member
  (§4.4), a third party who emails the account gets their **own** chat/session and
  never joins the owner thread. The `send_message` tool (§4.5) can only target
  members of the current thread's group, so the agent cannot leak the owner thread
  to an arbitrary address either.
- **Durable-record-before-cursor.** Insert the row into `messages` (the durable
  dedup record) BEFORE `markSeen`. A crash between the two then re-ingests
  harmlessly (dedup catches it) rather than dropping the message.
- Email channel disabled (default) → zero behavior change; existing installs
  unaffected.
- himalaya not configured while channel enabled → channel logs a clear "configure
  himalaya account X" warning and yields nothing; `doctor` surfaces it.

## 7. Testing (TDD)

- `resolvePrimaryChatRef` — pure unit tests: member→group primary, non-member→own
  identity, multiple groups, empty links.
- `email transport` — inject a fake `himalaya` exec; assert the argv for
  list/send/markSeen and the envelope→InboundMessage mapping (Message-ID as
  providerUpdateId, **missing-Message-ID fallback key**, sender-address as
  providerChatId, self-mail skip).
- `email.channel` — drive `receive()` with a fake transport yielding two
  envelopes (one self-sent → filtered); assert one InboundMessage out, and that
  `markSeen` is called only AFTER the yield; assert `stop()` ends the generator
  promptly (abortable sleep).
- Router link integration — inbound from the linked email address + the linked
  telegram chat land in the SAME (primary) session; an UNLINKED sender gets its
  own session; idle-reset / `/new` on a linked email act on the primary session.
- **Outbound channel-selection** — a turn whose agent calls
  `send_message({channel:'email'})` produces an outbox row with `provider='email'`
  and the linked recipient; targeting a non-member channel is rejected.
- No real IMAP/SMTP in any test (project policy: real plumbing only via opt-in,
  network-guarded tests).

## 8. Out of Scope (YAGNI) + accepted limitations

- Real IMAP IDLE push (poll only this pass).
- Per-email-thread sessions, attachments beyond text, HTML rendering.
- A schema migration for sessions (the primary-chat approach avoids it; §4.4).
- Auto-replying without the agent (the agent always decides — D2).
- **Accepted limitation — unseen-flag cursor:** new mail is detected via the
  IMAP `unseen` flag and marked seen after ingest. If a human (or another mail
  client) reads/marks-seen a message before the poll, the bot will NOT ingest it.
  For a single-owner learning bot this is an acceptable v1 tradeoff, not a bug. A
  stored timestamp cursor (future) would remove it.

## 9. Resolved Questions (were open; settled during spec review)

1. **Email `providerChatId` granularity** — RESOLVED: **per sender address**
   (§4.3). Account-level was rejected because it would route every correspondent
   into the one email identity and (with the owner link) merge strangers into the
   owner thread — violating the §6 stranger-isolation property. Per-sender keeps
   strangers isolated; only the owner's own address is linked.
2. **Poll cursor** — RESOLVED: **IMAP `unseen` flag**, mark-seen AFTER a durable
   `messages` insert (§6). Simplest + himalaya-native. The "human reads elsewhere
   → missed message" tradeoff is an explicit accepted limitation (§8), not a bug.

## 10. Success Criteria

1. With the email channel enabled + a himalaya account configured, a new INBOX
   message produces exactly one `InboundMessage` (deduped by Message-ID), and the
   bot's own sent mail is never re-ingested.
2. A linked Telegram chat and the linked email address share one session; the
   agent's context contains both; an unlinked chat stays isolated.
3. The agent can reply to an inbound email via Telegram or via email, its choice.
4. Email channel disabled by default → no behavior change for existing installs.
5. `resolvePrimaryChatRef` + transport + channel mapping are unit-tested with no
   network; `pnpm check` green.
