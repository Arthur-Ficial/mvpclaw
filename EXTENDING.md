# Extending MVPClaw

MVPClaw has exactly five extension points. Each is a small, well-bounded change
that follows an existing pattern in the tree. The golden rule throughout:

> **Configuration is the single source of truth.** Every behavior toggle lives in
> `mvpclaw.config.json`, declared in the Zod schema (`src/config/config.schema.ts`).
> Secrets are referenced by env-var **name** only — never inlined.

Before you start: `nvm use 24 && corepack enable && pnpm install`, and keep
`pnpm check` green (it is the acceptance gate: typecheck + lint + format + build
+ unit + e2e). Every exported symbol needs a TSDoc block — lint enforces it.

---

## 1. Add a tool

A tool is a function the agent can call. Tools live in `src/tools/`; the
dangerous "power" tools are split into `src/tools/power/<area>.ts`.

**Recipe** (mirror `src/tools/power/bash.ts`):

1. Create `src/tools/my-tool.ts` exporting a factory that returns a `ToolHandler`
   (`name`, `description`, JSON-schema `inputSchema`, `source: 'builtin'`,
   `enabled`, and an `execute(input, execCtx)`):

   ```ts
   import type { ToolHandler } from './tool.js';

   /** Build the `my_tool` handler. */
   export function myTool(enabled: boolean): ToolHandler {
     return {
       definition: {
         name: 'my_tool',
         description: 'One sentence the model reads to decide when to call it.',
         inputSchema: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
         source: 'builtin',
         enabled,
       },
       execute(input) {
         if (!enabled) throw new Error('my_tool is disabled');
         const p = input as { x: string };
         return Promise.resolve({ echoed: p.x });
       },
     };
   }
   ```

2. Register it where built-ins are wired (`src/tools/index.ts` /
   `registerBuiltinTools`, or `src/tools/power/index.ts` for a power tool):
   `registry.register(myTool(config.power.enabled && config.power.myTool));`

3. Gate it with a config flag — add `myTool: z.boolean().default(true)` to
   `PowerConfig` (or the relevant block) so it is toggleable from the SSOT.

4. Test: drive it via the CLI — `mvpclaw tool call my_tool --json <<< '{"x":"hi"}'`.

---

## 2. Add a skill

A skill is markdown instructions the agent loads at boot (it is not code). Skills
live in `skills/<name>/SKILL.md`.

**Recipe** (mirror `skills/github-deploy/SKILL.md`):

1. Create `skills/<name>/SKILL.md` with frontmatter and a procedure:

   ```markdown
   ---
   name: my-skill
   description: One sentence — when should the agent reach for this? (the model reads this)
   enabled: true
   ---

   # my-skill

   ## Procedure
   1. ...steps the agent follows, e.g. which CLI to run via `bash_exec`...
   ```

   The folder name MUST equal the frontmatter `name` (lowercase, `[a-z][a-z0-9-]*`).

2. Toggle from the SSOT: config wins over the `enabled:` frontmatter. Add the name
   to `skills.disabled` to force-off, or to `skills.enabled` (a non-empty allowlist)
   to force-on. Empty lists → the frontmatter default applies.

3. Validate: `mvpclaw skill validate` (and `mvpclaw skill list`).

If the skill drives a host CLI, consider adding a warn-level presence check in
`src/cli/cmd/doctor.cmd.ts` (see how `gh`/`vercel`/`himalaya` are probed).

---

## 3. Add an LLM provider

A provider turns a conversation into a reply. Providers live in `src/agent/` and
implement `AgentProviderAdapter`.

**Recipe** (mirror `src/agent/openrouter.provider.ts`):

1. Add the provider name to the `AgentProviderName` enum in
   `src/config/config.schema.ts` (e.g. `z.enum(['claude-cli', 'openrouter', 'myllm'])`)
   and add a config block for its options if it needs any.

2. Create `src/agent/myllm.provider.ts` implementing `AgentProviderAdapter`
   (the streaming + tool-call contract — copy the shape from the OpenRouter one).

3. Wire it into the `providers` record in `src/app/build-app-context.ts` (only when
   its key/config is present). `config.agent.provider` selects the active one.

4. There is no automatic failover by design — selection is explicit in config.

---

## 4. Add a channel

A channel is an inbound/outbound transport (Telegram + email today; CLI-injection
for tests). Channels live in `src/channels/` and implement the `ChannelAdapter`
interface from `src/channels/channel.ts`.

**`src/channels/email.channel.ts` is the worked example for a poll-based channel:**
it drives the `himalaya` CLI through an injectable transport (`src/email/`), uses
an abortable `stop()` so shutdown doesn't wait a poll interval, and dedups by the
RFC `Message-ID`. Mirror it for any polled source (RSS, IMAP, a webhook queue).

**Channel links + one shared thread:** `links` in config ties identities into one
session (`src/links/resolvePrimaryChatRef`). The router maps a linked inbound to
the group's `primary` chat, so e.g. email + Telegram become one conversation. The
agent replies cross-channel via the `send_message` tool. To make a new channel
linkable, nothing extra is needed — links key on `(channel, id)` generically.

**Recipe** (mirror `src/channels/telegram.channel.ts` for push, or
`email.channel.ts` for poll):

1. Create `src/channels/<name>.channel.ts` implementing `Channel` — receive
   inbound messages, hand them to the router, and send outbound from the outbox.

2. **Keep transport-specific deps inside this file.** Business logic (router,
   orchestrator, outbox) must not import channel SDK types — that boundary is a
   project rule (no `grammy` import outside the Telegram channel).

3. Add a config block (e.g. `discord: { enabled, tokenEnv, ... }`) to the schema,
   secrets by env-var name, and start the channel in `src/cli/cmd/start.cmd.ts`
   when enabled.

4. Test without the real network: drive the pipeline with
   `mvpclaw send --channel <name> ...` (the cli-inject path).

---

## 5. Add a config knob

The SSOT is the schema. To expose a new setting:

1. Add the field with a default + a one-line TSDoc to the right block in
   `src/config/config.schema.ts` (e.g. `maxFoo: z.number().int().positive().default(5)`).
2. Surface it in **both** `mvpclaw.config.json` and `mvpclaw.config.example.json`.
3. Read it where consumed via the typed config object (never read `process.env`
   for behavior — env is only for secret values referenced by name).
4. Add it to the config-map table in [`README.md`](./README.md).
5. Add a parse test in `tests/unit/config_load.test.ts`.

That's it — `mvpclaw config get <path>` will read it, `mvpclaw config validate`
will check it, and the whole system stays driveable from the CLI.
