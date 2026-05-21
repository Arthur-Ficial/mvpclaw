# MVPClaw

A single-process Node.js/TypeScript template that bridges Telegram to one AI agent — OpenRouter by default, or the Claude CLI as a swap-in provider.

> **The AI coding agent is the installer.** Clone it, open it with Claude Code, say "make this work."

It is a learning-friendly template: clean, small, single-source-of-truth config, fully driveable from a Unix-style CLI, and easy to extend. Security hardening is explicitly **not** a goal — readability is.

---

## Two ways to install

### 1. Let the agent do it (the point of this repo)

```bash
git clone https://github.com/Arthur-Ficial/mvpclaw.git mybot
cd mybot
claude        # or: codex
> make this work
```

The agent reads [`CLAUDE.md`](./CLAUDE.md) → [`INSTALL.md`](./INSTALL.md), asks you ≤ 6 questions (project name, install mode, deployment, provider, Telegram token, OpenRouter key), writes `.env`, installs deps, applies migrations, runs `pnpm check`, and starts the bot.

### 2. By hand (60 seconds)

```bash
nvm use 24 || nvm install 24      # Node 24 LTS (see .nvmrc)
corepack enable                   # pnpm via the pinned version
pnpm install
cp .env.example .env              # then fill TELEGRAM_BOT_TOKEN + OPENROUTER_API_KEY
# edit mvpclaw.config.json to taste (it is the single source of truth)
pnpm check                        # typecheck + lint + format + build + tests — must be green
pnpm dev                          # start the bot (Telegram poller + scheduler + outbox)
```

No `npx`, no global install, no infrastructure. One process, one SQLite file, one config file.

---

## CLI-first / AI-steerable (the core idea)

Telegram is just one channel. **Every capability is a Unix-style sub-command**, so an AI agent (or you) can drive, test, and observe the whole system without touching Telegram. `--json` everywhere; stdout = data, stderr = logs; defined exit codes.

```bash
# inject a message through the real router → orchestrator → provider → outbox path:
mvpclaw send --channel telegram --chat-id 12345 --user-id 67890 --text "hello" --json
```

| Command | What it does |
| --- | --- |
| `send` | Inject a message via a channel (the killer command) |
| `agent` | Run / replay / dry-run an agent turn directly |
| `tool` | List / describe / call any registered tool |
| `task` | Schedule / list / show / cancel / pause / resume / run-now |
| `memory` | show / append / clear / grep / archive memory |
| `skill` | List / show / validate / sync AgentSkills |
| `mcp` | List / inspect / test / serve MCP servers |
| `chat` · `outbox` | Inspect chats and the outgoing message queue |
| `db` · `trace` | Read-only SQL / migrate; list / show / tail run traces |
| `config` | **get / set / validate / diff the SSOT config** |
| `doctor` · `status` | Health checks and a runtime snapshot |
| `start` · `revive` | Start the daemon; clear the killswitch |

Run `mvpclaw <cmd> --help` for any command.

---

## Configuration is a single source of truth

Everything that changes behavior lives in **`mvpclaw.config.json`**, validated by a strict Zod schema (`src/config/config.schema.ts`). Secrets are referenced **by env-var name only** (e.g. `"tokenEnv": "TELEGRAM_BOT_TOKEN"`); real values live in a gitignored `.env`. Read or change config from the CLI with `mvpclaw config get|set|validate|diff`.

| Block | Controls |
| --- | --- |
| `app` | name, data/workspace dirs, default timezone |
| `database` | SQLite file URL |
| `telegram` | bot token env, polling/webhook, allowlists, reply mode, streaming |
| `agent` | **which provider** (`openrouter` or `claude-cli`), timeouts, history/tool-round caps |
| `claudeCli` | how the Claude CLI bridge is spawned (routes through OpenRouter) |
| `openrouter` | API key env, base URL, default model, server tools |
| `anthropic` · `gemini` | optional SDK tools (web search / research / image) |
| `mcp` | MCP servers consumed + which internal servers are exposed |
| `skills` | `loadAll` + `enabled[]` / `disabled[]` skill toggles |
| `deploys` | `github` (visibility) + `vercel` (target/scope) defaults for the deploy skills |
| `email` | himalaya account + page size for the email skill; `email.channel` polls an inbox as a channel |
| `links` | channel-link groups — tie identities (e.g. owner Telegram + email) into one shared thread |
| `proactive` · `idle` | proactive-send policy; sliding-window / idle reset |
| `power` | per-tool switches for the dangerous power tools |
| `logging` | level + secret-redaction list |

---

## Provider: OpenRouter primary, Claude swappable

OpenRouter is the default provider (`agent.provider: "openrouter"`). To use the Claude CLI instead, set `agent.provider: "claude-cli"` — it runs the real `claude` binary but points it at OpenRouter so it does not consume a Claude subscription. This is a **manual swap**, not automatic failover: if the selected provider errors, the run errors (it does not silently retry the other one).

---

## Built-in skills

[AgentSkills](./skills) are markdown (`skills/<name>/SKILL.md`) the agent loads at boot. Toggle them in config (`skills.enabled` / `skills.disabled`); config wins over a skill's own `enabled:` frontmatter. Notable skills:

- **email** — check / send / reply via the `himalaya` CLI
- **github-deploy** — create a repo, push, release via `gh`
- **vercel-deploy** — deploy preview/production and set env via `vercel`
- **memory**, **tasks**, **self-modification**, **research**, …

The deploy/email skills shell out to host CLIs (`gh`, `vercel`, `himalaya`); `mvpclaw doctor` reports whether each is installed.

---

## What it is not

Not a CLI-published tool. Not multi-agent. Not security-hardened. Not a wizard. One process, one config file, one acceptance gate.

## Stack

Node.js 24 LTS · TypeScript strict · Vitest · SQLite (better-sqlite3, raw SQL migrations) · grammY · citty · croner · Pino · Zod · `@modelcontextprotocol/sdk` · `@anthropic-ai/sdk` · `@google/genai` · pnpm

## Docs

- [`EXTENDING.md`](./EXTENDING.md) — **how to add a tool, skill, provider, channel, or config knob**
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full system architecture (the deep dive)
- [`CLAUDE.md`](./CLAUDE.md) — rules for the dev agent
- [`INSTALL.md`](./INSTALL.md) — agent-executable install playbook
- [`prompts/internal-agent/CLAUDE.md`](./prompts/internal-agent/CLAUDE.md) — the bot's own identity prompt

## License

MIT (pending public release).
