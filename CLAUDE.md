# CLAUDE.md — MVPClaw Project Bootstrap

You are operating inside a clone of **MVPClaw**, a single-process Node.js/TypeScript bridge between AI agents and chat channels. Telegram is the first channel; the CLI is the primary, first-class interface.

## Golden goal

A template for a zero-install, Claude-Code-installable, working, minimal-TDD, ultra-understandable TypeScript source, 100% linted, end-to-end claw product.

Every decision here serves that goal. If a proposed change pulls away from "a junior dev can read this and understand it in 30 minutes," reject the change.

## CLI-first / AI-steerable (non-negotiable)

MVPClaw's primary interface is its CLI, not Telegram. Telegram is one channel adapter among N (future: Discord, Slack, WhatsApp, voice). Every agent capability — receiving a "message", invoking a tool, scheduling a task, reading memory, replaying a run — is available as a Unix-style CLI command. An AI agent (or a human) can drive, test, and observe the entire system without touching Telegram.

### The killer command

```bash
mvpclaw send --channel telegram --chat-id 12345 --user-id 67890 \
             --text "is this a real message?"
```

This injects a synthetic `InboundMessage` and runs it through the exact same router → orchestrator → provider → outbox path a real Telegram update would follow. Output (reply text, trace path, run id) goes to stdout; pass `--json` for structured output.

### Unix-style conventions (mandatory)

- One command does one thing; compose via pipes.
- `--json` flag universally; default human output for terminals (auto-detect TTY).
- Exit codes: `0` success, `1` usage error, `2` config error, `3` runtime error, `4` not found, `5` timeout.
- stdin accepts JSON input where it makes sense (e.g. `mvpclaw send --json < input.json`).
- stdout = data, stderr = logs/progress. Never mix them.
- `--quiet` suppresses non-error output; `--verbose` adds structured progress to stderr.
- No interactive prompts in any command. Required input that's missing → exit 1 with a clear stderr message.
- Help text (`mvpclaw <cmd> --help`) is the contract; CI fails if a command's help is empty or out of sync with its code.

### Source code IS the documentation

No separate generated docs site, no TypeDoc HTML output, no docs portal. The codebase documents itself, enforced by:

- TSDoc/JSDoc on every exported symbol (`@public`, `@param`, `@returns`, `@example`). Lint blocks merges without these.
- File and function naming: a file's name predicts its contents; a function's name predicts its behavior.
- Each `src/<area>/` folder has an `index.ts` whose top-of-file JSDoc block is the area overview (1–3 sentences, scannable in seconds).
- Every CLI sub-command's `meta.description` is a one-line behavioral summary; help text generated from `meta` is the user-facing doc.
- `pnpm check` fails on missing docstrings on public symbols.

### The complete CLI surface (sub-commands)

```
mvpclaw send        # inject a message via any channel
mvpclaw outbox      # list / tail / peek / flush / cancel outgoing messages
mvpclaw chat        # list / show / new / reset chats
mvpclaw agent       # run / replay / dry-run an agent turn directly
mvpclaw tool        # list / describe / call any registered tool
mvpclaw task        # schedule / list / show / cancel / pause / resume / run-now
mvpclaw memory      # show / append / edit / clear / archive / grep (runtime + chat scopes)
mvpclaw skill       # list / show / validate / sync / invoke
mvpclaw mcp         # list / inspect / test MCP servers (internal + external)
mvpclaw db          # query (read-only) / migrate / vacuum / dump
mvpclaw trace       # list / show / tail / filter run traces
mvpclaw config      # get / set / validate / diff
mvpclaw doctor      # health check
mvpclaw status      # current configured provider, DB stats, MCP reachability
mvpclaw replay      # alias → agent replay
mvpclaw start       # start the daemon (channel pollers + scheduler + outbox)
mvpclaw kill        # stop the daemon + keep it down (engage killswitch)
mvpclaw revive      # disengage killswitch + bootstrap the daemon back into launchd
```

### Lifecycle is fully CLI-controllable (non-negotiable)

The entire daemon lifecycle is driveable from Unix-style commands — no GUI, no
manual `launchctl`. An AI managing this bot controls it end to end with:

```
install : ./scripts/install-daemon.sh   # load into launchd (KeepAlive + watchdog)
start   : mvpclaw start                  # run in foreground (dev), or the daemon runs it
observe : mvpclaw status                 # provider/DB/health   |  mvpclaw doctor
stop    : mvpclaw kill                   # engage killswitch + launchctl bootout (stays down)
restart : mvpclaw revive                 # disengage killswitch + re-bootstrap
```

`kill` writes the `~/.mvpclaw/killswitch` sentinel so the 5-minute watchdog and
launchd `KeepAlive: true` will NOT resurrect the daemon — it is the one reliable
"stay stopped" command. `revive` is its exact inverse. Every state transition is
a single command with `--json` output and standard exit codes; keep it that way
when adding lifecycle behavior.

## Your first task

Check whether the project is installed:

```bash
test -f .mvpclaw-install.json && echo INSTALLED || echo FRESH
```

- **FRESH** → open `./INSTALL.md` and execute it top to bottom. INSTALL.md is the install playbook; it tells you what to ask the user, what files to write, and what commands to run. Default mode is automated; switch to lockdown mode only if `.mvpclaw-lockdown` exists or the user explicitly asks.
- **INSTALLED** → read `.mvpclaw-install.json` to understand the install (mode, deployment, provider), then help the user with whatever they asked. Do NOT re-run INSTALL.md.

## Stack (frozen — do not change without spec update)

- Node.js 24 LTS, TypeScript strict
- Vitest (unit + integration + e2e)
- SQLite via `better-sqlite3` / `node:sqlite` + Drizzle
- grammY (Telegram channel adapter), Pino + redaction, Zod (config)
- citty (CLI framework — TypeScript-native, JSON-friendly)
- croner (cron parser only — in-process drift-corrected tick owns timing)
- `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, `@google/genai`
- pnpm; Docker optional
- Lint: ESLint + `eslint-plugin-jsdoc` + `eslint-plugin-tsdoc` (enforces source-as-docs)

## Code quality rules (apply always)

- TypeScript strict. No `any` without a justified comment.
- Tests first (Vitest). `pnpm check` MUST pass before claiming "done".
- One SSOT config: `mvpclaw.config.json`. No scattered config.
- Files under 250 lines when reasonable; functions under 50 lines when reasonable.
- Adapters wrap external calls; business logic stays pure and injectable.
- One ToolRegistry, one prompt builder, one outbox worker, one DB factory.
- No global mutable state.
- Every external call injectable for tests.

## Architecture rules

- Keep channel adapter code (Telegram and CLI-injection today) inside `src/channels/`. Each channel implements the `ChannelAdapter` interface from `src/channels/channel.ts`.
- Keep CLI sub-command code inside `src/cli/cmd/<name>.ts`. One file per top-level command. Single entrypoint at `src/cli/main.ts`.
- Keep provider code inside `src/agent/`.
- Keep MCP code inside `src/mcp/`.
- Keep skills code inside `src/skills/`.
- Keep scheduler code inside `src/scheduler/`.
- Business logic (router, orchestrator, outbox) SHALL NOT import channel-specific types. No `grammy` import outside `src/channels/telegram.channel.ts`.
- Use `mvpclaw.config.json` as the only configuration source.
- Do not add Redis, queues, web UI, workers, or multi-agent abstractions.

## Test rules

- Every feature starts with a Vitest test.
- No network calls in unit tests — use fake fetch, fake Claude CLI, fake Telegram.
- E2E tests use fake Telegram and fake provider adapters.
- `pnpm check` runs typecheck + lint + format:check + test + test:e2e + build.

## Commands

```bash
pnpm install
pnpm dev              # start the bot (foreground)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .
pnpm format:check     # prettier --check .
pnpm test             # vitest run tests/unit tests/integration
pnpm test:e2e         # vitest run tests/e2e
pnpm build            # tsc -p tsconfig.json
pnpm check            # all of the above — single acceptance gate
```

## Four CLAUDE.md files (do not confuse them)

1. `./CLAUDE.md` — this file. Rules for YOU (the dev agent).
2. `./prompts/internal-agent/CLAUDE.md` — the Telegram bot's own identity prompt (committed source; synced to the runtime workspace at boot).
3. `~/.mvpclaw/workspaces/default/CLAUDE.local.md` — the Telegram bot's runtime memory (gitignored, agent-editable via the `memory_append` MCP tool).
4. `./CLAUDE.local.md` — local dev preferences for whoever has the repo cloned (gitignored; not your business).

Claude CLI MUST run with `cwd = ~/.mvpclaw/workspaces/default`, NOT the repo root. Otherwise the Telegram agent reads the wrong CLAUDE.md.

## Architecture reference

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) in this repo for the full system layout, data flow, SQLite schema, scheduler design, prompt composition pipeline, and acceptance criteria.

## Never do

- Never commit `.env`, `data/`, or `workspace/`.
- Never push to `mvpclaw-upstream` (in fork mode it's the template, not the user's repo).
- Never claim a feature works without a passing test.
- Never run install steps if `.mvpclaw-install.json` already exists — the project is set up.
- Never use `--dangerously-skip-permissions` in default Claude CLI config.
- Never store secrets in `mvpclaw.config.json` — reference env-var names only.

## How to track work

All implementation work is decomposed into GitHub issues. Find the EPIC and child tickets at https://github.com/Arthur-Ficial/mvpclaw/issues. Each ticket has a "Spec source" section linking back to the canonical specification.
