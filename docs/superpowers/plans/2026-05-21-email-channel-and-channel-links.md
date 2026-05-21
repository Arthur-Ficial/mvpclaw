# Email Channel + Configurable Channel Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add email as a first-class channel (poll via the same `himalaya` CLI the skill uses) and a configurable channel-`links` mechanism so linked identities (default: owner's Telegram + email) share one conversation session, with an agent-callable `send_message` tool so the agent can reply cross-channel.

**Architecture:** Incremental, follows existing patterns. New: a `himalaya` transport wrapper, an `email` ChannelAdapter, a pure `resolvePrimaryChatRef` link resolver wired into `inbound-router`, a `send_message` builtin tool, and two SSOT config blocks (`email.channel`, `links`). No schema migration (linked members share the primary chat's session). Email channel is OFF by default → zero change for existing installs.

**Tech Stack:** Node 24, TypeScript strict, Vitest, Zod, citty, better-sqlite3, the `himalaya` CLI (already used by the skill). All external calls injectable via `spawnSync` wrappers (no network in tests).

**Spec:** `docs/superpowers/specs/2026-05-21-email-channel-and-channel-links-design.md`

**Conventions:** TDD (failing test first), files < 250 lines, TSDoc on exports (lint enforces), config is the only behavior source, secrets via himalaya's own store (not env). `pnpm check` is the gate. Run all commands under Node 24: `source ~/.nvm/nvm.sh && nvm use 24`.

---

## File Structure

- Create `src/email/transport.ts` — himalaya wrapper (`listNew`/`send`/`markSeen`), injectable runner. ~120 lines.
- Create `src/email/index.ts` — area overview + re-exports.
- Create `src/channels/email.channel.ts` — `ChannelAdapter` (poll `receive()` + `stop()` + `send()`). ~150 lines.
- Create `src/links/resolve.ts` — pure `resolvePrimaryChatRef`. ~40 lines.
- Create `src/links/index.ts` — overview + re-export.
- Modify `src/config/config.schema.ts` — add email.channel + links schema; wire into top-level.
- Modify `src/app/inbound-router.ts` — link-aware session resolution.
- Modify the builtin-tools registrar — add `send_message` tool.
- Modify `src/app/build-app-context.ts` — wire email channel (gated) + pass links to router.
- Modify `src/cli/cmd/start.cmd.ts` — call email channel `stop()` on shutdown.
- Modify `src/cli/cmd/doctor.cmd.ts` — warn when email channel enabled but unconfigured.
- Modify `mvpclaw.config.json` + `mvpclaw.config.example.json` — add the two blocks.
- Modify `CLAUDE.md` + `EXTENDING.md` — document channels/links.
- Tests: `tests/unit/links-resolve.test.ts`, `tests/unit/email-transport.test.ts`, `tests/unit/email-channel.test.ts`, `tests/integration/router-links.test.ts`, `tests/unit/send-message-tool.test.ts`, `tests/unit/config_load.test.ts` (extend).

---

## Phase A — Channel links resolver (pure, foundational)

### Task A1: `resolvePrimaryChatRef`

**Files:** Create `src/links/resolve.ts`, `src/links/index.ts`; Test `tests/unit/links-resolve.test.ts`.

- [ ] **Step 1: Failing test** (`tests/unit/links-resolve.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { resolvePrimaryChatRef } from '../../src/links/resolve.js';

const links = [
  {
    id: 'owner',
    primary: { channel: 'telegram', id: '111' },
    members: [
      { channel: 'telegram', id: '111' },
      { channel: 'email', id: 'me@example.com' },
    ],
  },
];

describe('resolvePrimaryChatRef', () => {
  it('maps a linked member to the group primary', () => {
    expect(resolvePrimaryChatRef('email', 'me@example.com', links)).toEqual({
      channel: 'telegram',
      id: '111',
    });
  });
  it('returns the identity unchanged when not a member', () => {
    expect(resolvePrimaryChatRef('email', 'stranger@x.com', links)).toEqual({
      channel: 'email',
      id: 'stranger@x.com',
    });
  });
  it('returns identity unchanged when links is empty', () => {
    expect(resolvePrimaryChatRef('telegram', '111', [])).toEqual({ channel: 'telegram', id: '111' });
  });
});
```

- [ ] **Step 2: Run, fail.** `pnpm test -- links-resolve` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/links/resolve.ts`:

```ts
/**
 * Channel-link resolution — maps a (channel, id) identity to the primary chat
 * of its link group, so linked identities share one session. Pure + total.
 */
export interface ChatRef {
  channel: string;
  id: string;
}
export interface LinkGroup {
  id: string;
  primary: ChatRef;
  members: ChatRef[];
}

/**
 * Resolve the session-owning chat for an inbound identity.
 *
 * @param channel - Inbound channel name.
 * @param id - Inbound provider chat id (telegram chat_id / email sender address).
 * @param links - Configured link groups.
 * @returns The group primary when the identity is a member, else the identity itself.
 */
export function resolvePrimaryChatRef(channel: string, id: string, links: LinkGroup[]): ChatRef {
  for (const g of links) {
    if (g.members.some((m) => m.channel === channel && m.id === id)) {
      return g.primary;
    }
  }
  return { channel, id };
}
```

Create `src/links/index.ts` with an area-overview JSDoc + `export * from './resolve.js';`.

- [ ] **Step 4: Pass.** `pnpm test -- links-resolve` → PASS.
- [ ] **Step 5: Commit** — `feat(links): pure resolvePrimaryChatRef link resolver`.

### Task A2: `links` + `email.channel` config schema

**Files:** Modify `src/config/config.schema.ts`; Test extend `tests/unit/config_load.test.ts`.

- [ ] **Step 1: Failing test** — assert defaults: `cfg.links` is `[]`; `cfg.email.channel.enabled === false`, `pollIntervalSec === 120`. (Use the existing `loadConfig(temp)` pattern.)
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** Add `ChatRefSchema`, `LinkGroupSchema`, top-level `links`. Extend the existing `EmailConfig` with a nested `channel` object:

```ts
const ChatRefSchema = z.object({ channel: z.string().min(1), id: z.string().min(1) });
export const LinkGroupSchema = z.object({
  id: z.string().min(1),
  primary: ChatRefSchema,
  members: z.array(ChatRefSchema).min(1),
});
// inside EmailConfig:
channel: z
  .object({
    enabled: z.boolean().default(false),
    account: z.string().default(''),
    ownAddress: z.string().default(''),
    pollIntervalSec: z.number().int().positive().default(120),
  })
  .default({ enabled: false, account: '', ownAddress: '', pollIntervalSec: 120 }),
// top-level MvpClawConfig:
links: z.array(LinkGroupSchema).default([]),
```

- [ ] **Step 4: Pass + typecheck.**
- [ ] **Step 5:** Add the blocks to `mvpclaw.config.json` + `mvpclaw.config.example.json` (email.channel defaults; `links: []` with a comment showing the owner example). Run `mvpclaw config validate`.
- [ ] **Step 6: Commit** — `feat(config): add links + email.channel SSOT blocks`.

---

## Phase B — Email transport (himalaya wrapper)

### Task B1: `listNew` / `send` / `markSeen` with an injectable runner

**Files:** Create `src/email/transport.ts`, `src/email/index.ts`; Test `tests/unit/email-transport.test.ts`.

- [ ] **Step 1: Failing test.** Inject a fake runner `run(cmd, args, input?) → {stdout, status}` that RECORDS each call. Cases:
  - `listNew(account, ownAddress)` runs `himalaya envelope list -a <account> --query "<unseen-query>" -o json`, parses JSON, returns `{ id (Message-ID), from, subject, body, internalDate }[]`, and FILTERS OUT envelopes whose `from` === `ownAddress` (self-mail). (Verify the exact unseen-filter token against `himalaya envelope list --help` during impl — likely `not seen` / `unseen`; the test fixture drives the JSON shape, the argv assertion uses whatever token impl confirms.)
  - missing Message-ID → synthesize `account:uid:date` fallback id (assert non-empty).
  - `send(...)` issues TWO recorded calls (see Step 3 — pipe is modeled as two spawns).
  - `markSeen(account, ids)` runs `himalaya flag add <ids> seen`.
  Provide a fixture JSON mirroring himalaya's `-o json` envelope shape (see `skills/email/SKILL.md` for the command forms).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** `src/email/transport.ts`.
  - **Runner type:** `HimalayaRun = (cmd: string, args: string[], input?: string) => { stdout: string; status: number | null }`. Default impl = `spawnSync(cmd, args, { input, encoding: 'utf8' })` — **NO shell, NO pipe, NEVER `child_process.exec`** (the repo hook blocks it, and house style is no-shell `spawnSync`).
  - **`send` is a SHELL PIPE in the skill** (`himalaya template write -H ... <body> | himalaya message send`) — you CANNOT express `|` in a no-shell spawn. Model it as **two spawns chained via stdin**: (1) `run('himalaya', ['template','write','-H','To:'+to,'-H','Subject:'+subject, body, '-a', account, ...inReplyToHeaders])` → capture `stdout`; (2) `run('himalaya', ['message','send','-a',account], /* input: */ step1.stdout)`. Reply threads `-H 'In-Reply-To:<msgId>'` in step 1.
  - Keep pure JSON parsing in a separate helper from the I/O so parsing is unit-testable. < 250 lines.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `feat(email): himalaya transport (listNew/send/markSeen), injectable runner`.

---

## Phase C — Email channel adapter

### Task C1: `email.channel.ts` — poll receive() + stop() + send()

**Files:** Create `src/channels/email.channel.ts`; Modify `src/channels/index.ts`; Test `tests/unit/email-channel.test.ts`.

- [ ] **Step 1: Failing test.** Build the channel with a FAKE transport (inject) + an injected `sleep`:
  - `receive()` yields one `InboundMessage` per new envelope; `providerUpdateId` = Message-ID, `providerChatId` = sender address, `channel = 'email'`, `text` = subject+body.
  - `markSeen` is called AFTER the message is yielded (assert via the fake recording call order).
  - `stop()` makes the async iterator return promptly even mid-sleep (assert the generator completes within a tick, not after pollIntervalSec).
  - a self-sent envelope (already filtered by transport) → no message.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** Mirror `telegram.channel.ts` queue/waiter + `stop()` pattern. Poll loop: list new → enqueue mapped messages → mark seen → abortable sleep that resolves on `stop()`. Inject the transport + a `sleep` impl so tests don't wait.
- [ ] **Step 4: Pass + each file < 250 lines.**
- [ ] **Step 5: Commit** — `feat(channels): email channel (himalaya poll + abortable stop + SMTP send)`.

---

## Phase D — Link-aware routing

### Task D1: `inbound-router` resolves session by primary chat

**Files:** Modify `src/app/inbound-router.ts`; Test `tests/integration/router-links.test.ts`.

- [ ] **Step 1: Failing integration test** (real in-memory db + migrations):
  - With `links` linking telegram `111` + email `me@example.com`: route an inbound telegram msg (chat 111) and an inbound email msg (sender `me@example.com`); assert BOTH resolve to the SAME session id.
  - An UNLINKED email (`stranger@x.com`) routes to its OWN session (different id).
  - **Assert `resolved.chat` of the linked-email route is the PRIMARY (telegram 111) chat**, while the stored inbound message keeps `provider='email'`.
  - `/new` / idle-reset on the linked email acts on the primary session.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `routeInbound` takes the `links` config. Compute `primary = resolvePrimaryChatRef(msg.channel, msg.providerChatId, links)`. **Two chat rows:** `upsertChat` the REAL inbound identity (for message dedup + `messages.provider` accuracy), AND `upsertChat` the PRIMARY identity. **Critical:** the returned `ResolvedInbound.chat` and `.session` MUST be the PRIMARY chat's — the orchestrator builds the agent exec-context and the default-reply target from `resolved.chat`, and `send_message` (F1) finds the link group by matching that. Session-scoped ops (`getOrCreateActiveSession`, idle gap, `closeActiveSessions`/`/new`) all use the primary chat id. The inbound `message` row is inserted under the primary session but with its own `provider`. TSDoc the identity-vs-thread split.
- [ ] **Step 4: Pass + full `pnpm check`** (router is core).
- [ ] **Step 5: Commit** — `feat(router): link-aware session resolution`.

### Task D2: Thread `links` through callers

**Files:** all four `routeInbound(` call sites (verified by grep): `src/scheduler/dispatcher.ts:93`, `src/cli/cmd/start.cmd.ts:172`, `src/cli/cmd/agent.cmd.ts:104`, `src/app/send-message.ts:59`, plus 3 call sites in `tests/integration/orchestrator_e2e.test.ts`.

- [ ] **Step 1:** Add `links` to `routeInbound`'s signature. Note `send-message.ts` and `agent.cmd.ts` currently call it WITHOUT the optional `idle` arg — so add `links` as a trailing **optional** param (default `[]`) to keep all sites compiling; pass `config.links` from the sites that have config. Default `[]` keeps current behavior.
- [ ] **Step 2: Full gate** `pnpm check` → PASS.
- [ ] **Step 3: Commit** — `feat(router): wire config.links into routing`.

---

## Phase E — Wire the email channel in

### Task E1: Register channel + shutdown

**Files:** Modify `src/app/build-app-context.ts`, `src/cli/cmd/start.cmd.ts`.

- [ ] **Step 1:** In `build-app-context.ts`, after telegram wiring: if `config.email.channel.enabled` AND `config.email.channel.account` non-empty, `channels['email'] = createEmailChannel(config.email.channel, transport)`. **Return the email-channel handle from the context** (like the existing `telegram` handle at `build-app-context.ts:174`) so shutdown can reach it.
- [ ] **Step 2:** **NEW shutdown wiring (no existing precedent to copy).** `start.cmd.ts` today only sets `stopState.inboundStopped = true` and breaks after the next yield — it does NOT call `telegram.stop()` (Telegram's long-poll unblocks via grammY internals; a 120s email sleep will NOT). So in `start.cmd.ts`'s shutdown/drain callback, explicitly call `built.email?.stop()`. This is the abortable-shutdown requirement from spec §4.2.
- [ ] **Step 3:** Manual smoke (no creds): email.channel.enabled=false → `mvpclaw status` channels excludes email; enabled=true + fake account → `status` lists `email` and the process does not crash (poll errors are logged). Capture output.
- [ ] **Step 4: Full gate.**
- [ ] **Step 5: Commit** — `feat(app): wire email channel into context + shutdown`.

---

## Phase F — `send_message` tool (agent-directed cross-channel reply)

### Task F1: builtin `send_message` tool

**Files:** Modify the builtin-tools registrar (grep `registerBuiltinTools`); Test `tests/unit/send-message-tool.test.ts`.

- [ ] **Step 1: Failing test.** With execCtx (db + current chat in a link group), calling the tool with `{channel:'email', text:'hi'}` enqueues an outbox row with `provider='email'` + the linked member's id (resolved from the active thread's group). A channel NOT in the active group → returns an error (no outbox row).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** `sendMessageTool(config)` → `ToolHandler`. `execute(input, execCtx)`:
  1. Find the active thread's link group by matching `execCtx.channel` + `execCtx.providerChatId` against each group's `primary` (after D1, execCtx carries the PRIMARY identity) or members. No group / no links → clear error.
  2. Validate `input.channel` is a member of that group; else error (this is the §6 safety guard — agent can only send to linked identities).
  3. Resolve the target member's `{channel, id}`, then get its internal chat ULID via `ChatsRepo.upsertChat(db, { provider: member.channel, provider_chat_id: member.id, type:'private' })`.
  4. Enqueue with the REAL `outbox.repo` field names (snake_case; `chat_id` is required):
     `enqueueOutbox(execCtx.db, { chat_id: targetChat.id, provider: member.channel, provider_chat_id: member.id, kind: 'text', text: input.text })`.
  Gate registration on `config.links.length > 0`.
- [ ] **Step 4: Pass + gate.**
- [ ] **Step 5: Commit** — `feat(tools): send_message — agent replies on a chosen linked channel`.

---

## Phase G — doctor + docs

### Task G1: doctor warns when email channel enabled but unconfigured

**Files:** Modify `src/cli/cmd/doctor.cmd.ts`.

- [ ] **Step 1:** When `config.email.channel.enabled`, push a `severity:'warn'` check `email-channel`: ok when `himalaya` on PATH AND `account` set; else warn with the fix hint. Reuse the existing `onPath('himalaya')`.
- [ ] **Step 2:** `mvpclaw doctor --json` shows the check; run it. Full gate.
- [ ] **Step 3: Commit** — `feat(doctor): email-channel readiness check`.

### Task G2: Document channels + links

**Files:** Modify `CLAUDE.md` (channels/links + send_message, in the CLI/observability area), `EXTENDING.md` (note email is the worked "add a channel" example + how `links` work), README config map (add `links`, note `email.channel`).

- [ ] **Step 1:** Write the docs: email is both a skill (on-demand) and a channel (poll); `links` make linked identities share one thread; the agent replies cross-channel via `send_message`; all OFF by default.
- [ ] **Step 2:** `pnpm check` (cross_cut_invariants reads CLAUDE.md). Commit — `docs: channels + links + send_message`.

---

## Phase H — Verification

### Task H1: Full acceptance + e2e smoke

- [ ] **Step 1:** `pnpm check` green (typecheck + lint + format + build + unit + e2e).
- [ ] **Step 2:** File sizes — every new file < 250 lines (`wc -l src/email/*.ts src/channels/email.channel.ts src/links/*.ts`).
- [ ] **Step 3: link behavior proof (no network):** the `router-links` integration test (D1) is the authoritative proof linked identities share a session. Additionally run a cli-inject `mvpclaw send` smoke to confirm the pipeline still routes normally.
- [ ] **Step 4: Secret scan** — `git grep -nIE "franz|fullstackoptimization|apfel|arthurficial|/Users/arthur"` → zero (configs use example.com / 111).
- [ ] **Step 5:** Push: `git push origin main`.

---

## Done criteria (maps to spec §10)

1. Email channel enabled + himalaya configured → one InboundMessage per new INBOX mail (deduped by Message-ID); self-sent mail never re-ingested. (B1, C1)
2. Linked Telegram chat + linked email address share one session; unlinked sender isolated. (D1)
3. Agent can reply via Telegram or email by choice (`send_message`). (F1)
4. Email channel OFF by default → no behavior change. (A2, E1)
5. `resolvePrimaryChatRef` + transport + channel are unit-tested, no network; `pnpm check` green. (A1, B1, C1, H1)
