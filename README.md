# MVPClaw

A single-process Node.js/TypeScript template that bridges Telegram to one AI agent — Claude CLI by default (via OpenRouter), or direct OpenRouter API.

> **The AI coding agent is the installer.**

## Install

```bash
git clone https://github.com/Arthur-Ficial/mvpclaw.git mybot
cd mybot
claude        # or: codex
> make this work
```

The agent reads [`CLAUDE.md`](./CLAUDE.md) → [`INSTALL.md`](./INSTALL.md) and asks you ≤ 6 questions (project name, install mode, deployment, provider, Telegram token, OpenRouter key). Then it writes `.env`, installs deps, applies migrations, runs `pnpm check`, and starts the bot.

No `npx`. No global install. No wizard. No infrastructure required.

## What it is

- **Single agent** — one Telegram chat ↔ one AI agent
- **Local-first** — SQLite for everything; no Redis, no Postgres
- **Provider-agnostic** — Claude CLI bridge (default) or OpenRouter direct
- **Tool-rich** — MCP client + MCP server, AgentSkills, Gemini, Anthropic web search, OpenRouter server tools
- **Debuggable** — Pino JSON logs + per-run JSONL trace files; replay any run without Telegram
- **TDD-first** — Vitest unit + integration + e2e; `pnpm check` is the acceptance gate

## What it is not

Not a CLI tool. Not multi-agent. Not security-hardened. Not a wizard. One process, one config file, one acceptance gate. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

## Stack

Node.js 24 LTS · TypeScript strict · Vitest · SQLite (better-sqlite3 + Drizzle) · grammY · croner · Pino · Zod · `@modelcontextprotocol/sdk` · `@anthropic-ai/sdk` · `@google/genai` · pnpm

## Docs

- [`CLAUDE.md`](./CLAUDE.md) — rules for the dev agent
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full system architecture
- [`INSTALL.md`](./INSTALL.md) — agent-executable install playbook (added in ticket #F2)
- [`prompts/internal-agent/CLAUDE.md`](./prompts/internal-agent/CLAUDE.md) — the bot's own identity prompt (added in ticket #F3)

## License

MIT (pending public release).
