# CLAUDE.md — MVPClaw Project Bootstrap

You are operating inside a clone of **MVPClaw**, a single-process Node.js/TypeScript Telegram-to-AI-agent bridge that ships as a template repository.

## Golden goal

A template for a zero-install, Claude-Code-installable, working, minimal-TDD, ultra-understandable TypeScript source, 100% linted, end-to-end claw product.

Every decision here serves that goal. If a proposed change pulls away from "a junior dev can read this and understand it in 30 minutes," reject the change.

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
- grammY (Telegram), Pino + redaction, Zod (config)
- croner (cron parser only — in-process drift-corrected tick owns timing)
- `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, `@google/genai`
- pnpm; Docker optional

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

- Keep Telegram code inside `src/telegram`.
- Keep provider code inside `src/agent`.
- Keep MCP code inside `src/mcp`.
- Keep skills code inside `src/skills`.
- Keep scheduler code inside `src/scheduler`.
- Business logic SHALL NOT import Telegram-specific types.
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
