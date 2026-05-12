# MVPClaw — System Architecture

**Status:** Implementation-ready · **Version:** 0.2.0 · **Audience:** junior-to-senior TypeScript engineers and AI coding agents

This document is the single, self-contained reference for the MVPClaw system. It consolidates eight specification documents into one canonical architecture. The source briefing remains in the maintainer's local working copy and is not committed to this repo; everything required to build MVPClaw is here.

Normative language follows RFC 2119 / BCP 14: **MUST**, **SHALL**, **SHOULD**, **MAY**.

---

## 1. Overview

MVPClaw is a **minimal, single-agent, local-first agent bridge with a CLI-first surface**. One Node.js TypeScript process connects chat channels (Telegram first; Discord/Slack/voice are future channel adapters) to one AI agent, persists state in SQLite, supports both Claude CLI (default, via OpenRouter env injection) and direct OpenRouter API, exposes and consumes MCP tools, loads AgentSkills-compatible skills, and is testable with Vitest from day one.

**The CLI is the primary interface.** Telegram is one channel adapter among N. Every agent capability (receive a message, run a tool, schedule a task, read memory, replay a run) is reachable via a Unix-style CLI command. An AI agent or human can drive, test, and observe the whole system without touching Telegram.

**Golden goal:** A template for a zero-install, Claude-Code-installable, working, minimal-TDD, ultra-understandable TypeScript source, 100% linted, end-to-end claw product.

Every architectural decision here serves that goal. No microservices. No queue broker. No web frontend. No multi-agent framework. No containers required (Docker is optional). No wizard. No auto-generated docs site — the source code is the documentation, enforced by lint rules and `CLAUDE.md`. One config file. One process. One agent.

## 1bis. CLI-first / AI-steerable

### Killer command

```bash
mvpclaw send --channel telegram --chat-id 12345 --user-id 67890 \
             --text "is this a real message?"
```

This injects a synthetic `InboundMessage` through the channel-adapter layer and runs it through the exact same router → orchestrator → provider → outbox path a real Telegram update would follow. Same trace, same SQLite rows, same outbox behavior. With `--json`, output is structured `{runId, channel, chatId, userId, replyText?, tracePath, durationMs}`. With `--wait N`, the command blocks up to N seconds for the reply.

### Unix-style conventions (mandatory)

- One command, one job; compose via pipes.
- `--json` flag everywhere; default human output when `process.stdout.isTTY`.
- Exit codes: `0` success · `1` usage · `2` config · `3` runtime · `4` not found · `5` timeout.
- stdin accepts JSON where it makes sense (`mvpclaw send --json < input.json`).
- stdout = data, stderr = logs/progress. They never mix.
- `--quiet` suppresses non-error output; `--verbose` adds structured progress to stderr.
- No interactive prompts in any command.

### Sub-command surface

```
mvpclaw send       outbox    chat      agent     tool      task
        memory     skill     mcp       db        trace     config
        doctor     status    replay
```

Each top-level command lives in `src/cli/cmd/<name>.ts` and is dispatched by `src/cli/main.ts` via citty. Help text is generated from each command's `meta.description` block; CI fails if a command's help is empty.

### Channel-adapter abstraction

Channels are pluggable via the `ChannelAdapter` interface in `src/channels/channel.ts`:

```ts
export interface ChannelAdapter {
  readonly name: string;                     // "telegram" | "cli-inject" | "discord" | ...
  receive(): AsyncIterable<InboundMessage>;  // long-poll / webhook / synthetic input
  send(msg: OutboundMessage): Promise<void>; // for real channels; no-op for cli-inject
}
```

Implementations today: `telegramChannel` (grammY-backed) and `cliInjectChannel` (used by `mvpclaw send`). The router, orchestrator, and outbox import only `src/channels/`; no `grammy` import leaks past the adapter boundary.

### Source-as-documentation

There is no docs portal. The codebase documents itself:

- TSDoc/JSDoc required on every exported symbol (`@public`, `@param`, `@returns`, `@example`). `eslint-plugin-jsdoc` + `eslint-plugin-tsdoc` block merges without this.
- Each `src/<area>/` folder has an `index.ts` with a top-of-file JSDoc block that is the area's overview (1–3 scannable sentences).
- File and function names predict their contents.
- Every CLI sub-command's `meta.description` is the user-facing doc.
- `pnpm check` fails on undocumented public exports.

---

## 2. Stack (frozen)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 24 LTS | Has `node:sqlite`; reduces native-dep complexity |
| Language | TypeScript strict | No `any` without justified comment |
| Tests | Vitest (unit + integration + e2e) | Backend-compatible, no ceremony |
| DB | SQLite via `better-sqlite3` / `node:sqlite` + Drizzle | Embedded, atomic, replayable |
| Telegram | grammY | TypeScript-native bot framework |
| Scheduler | croner (parser only) | DST-correct, used by PM2/Uptime Kuma |
| Logging | Pino + secret redaction | Structured JSON, fast |
| Config | Zod + one `mvpclaw.config.json` | Single SSOT, validated |
| AI default | Claude CLI bridge (via OpenRouter env) | Stable headless mode |
| AI alternative | Direct OpenRouter API | Generic + server tools |
| MCP | `@modelcontextprotocol/sdk` | Spec-tracking SDK |
| Skills | AgentSkills `SKILL.md` folders | Claude Code-compatible |
| Optional tools | `@anthropic-ai/sdk`, `@google/genai` | Web search, Gemini research |
| Package manager | pnpm | Strict, reproducible |
| Deployment | Local (default) + Docker (optional) | Single Dockerfile + compose |

Versions are pinned to `latest` at template generation time and resolved during `pnpm install`. Node version is the only hard floor (24 LTS or newer).

---

## 3. Repository layout

```text
mvpclaw/
├── CLAUDE.md                       # rules for dev agent
├── ARCHITECTURE.md                 # this file
├── README.md
├── INSTALL.md                      # agent-executable install playbook
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── drizzle.config.ts
├── mvpclaw.config.example.json
├── .env.example
├── .gitignore
├── .mvpclaw-install.json           # committed AFTER install; documents install state
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── README.md
│
├── prompts/
│   └── internal-agent/
│       └── CLAUDE.md               # the Telegram bot's identity prompt
│
├── skills/
│   ├── research/SKILL.md
│   └── debugging/SKILL.md
│
├── src/
│   ├── index.ts
│   ├── cli/
│   │   ├── main.ts                 # citty entrypoint; dispatches to cmd/*
│   │   ├── output.ts               # stdout JSON / table writer; TTY detection
│   │   ├── exit.ts                 # exitUsage / exitConfig / exitRuntime / exitNotFound / exitTimeout
│   │   └── cmd/
│   │       ├── send.cmd.ts         # mvpclaw send (the killer command)
│   │       ├── outbox.cmd.ts       # list/tail/peek/flush/cancel
│   │       ├── chat.cmd.ts         # list/show/new/reset
│   │       ├── agent.cmd.ts        # run/replay/dry-run
│   │       ├── tool.cmd.ts         # list/describe/call
│   │       ├── task.cmd.ts         # schedule/list/show/cancel/pause/resume/run-now
│   │       ├── memory.cmd.ts       # show/append/edit/clear/archive/grep
│   │       ├── skill.cmd.ts        # list/show/validate/sync/invoke
│   │       ├── mcp.cmd.ts          # list/inspect/test
│   │       ├── db.cmd.ts           # query/migrate/vacuum/dump
│   │       ├── trace.cmd.ts        # list/show/tail/filter
│   │       ├── config.cmd.ts       # get/set/validate/diff
│   │       ├── doctor.cmd.ts       # health check
│   │       └── status.cmd.ts       # provider / DB / MCP reachability
│   ├── channels/
│   │   ├── channel.ts              # ChannelAdapter interface, InboundMessage, OutboundMessage
│   │   ├── telegram.channel.ts     # grammY-backed Telegram adapter (was src/telegram/)
│   │   └── cli-inject.channel.ts   # synthetic channel used by `mvpclaw send`
│   ├── config/
│   │   ├── config.schema.ts
│   │   └── load-config.ts
│   ├── domain/
│   │   ├── ids.ts
│   │   ├── messages.ts
│   │   ├── results.ts
│   │   └── errors.ts
│   ├── db/
│   │   ├── db.ts
│   │   ├── schema.ts
│   │   ├── migrate.ts
│   │   └── repos/
│   │       ├── chats.repo.ts
│   │       ├── messages.repo.ts
│   │       ├── runs.repo.ts
│   │       ├── outbox.repo.ts
│   │       ├── skills.repo.ts
│   │       ├── tasks.repo.ts
│   │       └── chat-memory.repo.ts
│   ├── app/
│   │   ├── app-context.ts
│   │   ├── inbound-router.ts
│   │   ├── agent-orchestrator.ts
│   │   ├── outbox-worker.ts
│   │   ├── prompt-builder.ts
│   │   └── run-tracer.ts
│   ├── agent/
│   │   ├── agent-provider.ts
│   │   ├── claude-cli.provider.ts
│   │   ├── openrouter.provider.ts
│   │   ├── openrouter.client.ts
│   │   └── tool-loop.ts
│   ├── tools/
│   │   ├── tool.ts
│   │   ├── tool-registry.ts
│   │   ├── builtins.ts
│   │   ├── openrouter-server-tools.ts
│   │   ├── anthropic-web-search.tool.ts
│   │   └── gemini-research.tool.ts
│   ├── mcp/
│   │   ├── mcp-client.ts
│   │   ├── mcp-config.ts
│   │   ├── mcp-tools-server.ts
│   │   └── mcp-conversations-server.ts
│   ├── skills/
│   │   ├── skill.ts
│   │   ├── skill-loader.ts
│   │   ├── skill-sync.ts
│   │   └── skill-validator.ts
│   ├── scheduler/
│   │   ├── index.ts
│   │   ├── loop.ts                 # drift-corrected tick + sweep
│   │   ├── dispatcher.ts           # atomic lease, fan-out
│   │   ├── recurrence.ts           # croner wrapper
│   │   ├── lifecycle.ts            # state machine
│   │   ├── catchup.ts              # missed-run policy
│   │   └── shutdown.ts             # graceful SIGTERM
│   ├── prompts/
│   │   ├── preamble.ts             # L0 static system preamble
│   │   ├── composer.ts             # §12 composition pipeline
│   │   └── redact.ts               # secret redactor for memory + logs
│   ├── memory/
│   │   ├── memory-tools.ts         # memory_read, memory_append MCP tools
│   │   └── memory-rotation.ts
│   └── logging/
│       ├── logger.ts
│       └── redact.ts
│
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_indices.sql
│   ├── 0003_tasks.sql
│   ├── 0004_chats_proactive.sql
│   └── 0005_chat_memory.sql
│
└── tests/
    ├── unit/
    ├── integration/
    ├── e2e/
    └── fixtures/
```

**Folder rule:** boring and predictable. A junior dev MUST know where to look.

---

## 4. Runtime flow

### 4.1 Telegram message → reply

```text
1. Telegram update arrives (long polling or webhook).
2. grammY adapter normalizes update → InboundMessage.
3. Router deduplicates by provider update ID (UNIQUE constraint on messages.provider_update_id).
4. Router resolves chat, user, and session in SQLite.
5. Router handles slash commands (/start, /help, /status, /new, /skills, /<skill-name>).
6. Router stores inbound message.
7. Agent orchestrator builds prompt via composer (§12).
8. Selected agent provider runs (Claude CLI default, OpenRouter alternative).
9. Tool calls execute through ToolRegistry or MCP.
10. Final answer stored in messages + agent_runs.
11. Outbox row created (status='pending').
12. Outbox worker (inside the tick loop) sends or edits Telegram message.
13. Per-run JSONL trace finalized at data/traces/<runId>.jsonl.
```

### 4.2 Scheduled task wakeup

```text
1. Fast tick (every 1000ms) queries:
   SELECT * FROM tasks WHERE state='scheduled' AND next_run_at <= now() ORDER BY next_run_at LIMIT N
2. Dispatcher acquires atomic lease:
   UPDATE tasks SET state='running', lease_owner=?, lease_until=now()+lease_ttl
   WHERE id=? AND state='scheduled'
3. db.changes()===1 confirms lease ownership; ===0 means another tick won (skip).
4. Agent runs with the task's stored prompt.
5. Outbox creates a proactive message; outbox gates evaluate (§11).
6. Telegram sends with disable_notification=true if quiet-hours policy=silent.
7. On success: recurring → compute next_run_at via croner; one-shot → state='completed'.
```

### 4.3 Claude CLI provider invocation

```text
1. Build prompt file + system prompt file in workspace/runs/<runId>/.
2. Build generated MCP config file in workspace/runs/<runId>/mcp.json.
3. Spawn `claude --bare -p "$PROMPT" \
                 --append-system-prompt-file <SYSTEM> \
                 --mcp-config <MCP_CONFIG> \
                 --allowedTools "Read,mcp__mvpclaw-tools__*,mcp__configured-*__*" \
                 --output-format stream-json \
                 --verbose \
                 --include-partial-messages`
4. Parse newline-delimited JSON events from stdout.
5. Emit text deltas to the Telegram streaming adapter (edits an existing message every editIntervalMs).
6. Store final result, usage, debug trace.
```

`--bare` is mandatory: avoids accidental local hooks/plugins/memory.

OpenRouter env injection for Claude CLI:

```bash
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=$OPENROUTER_API_KEY
ANTHROPIC_API_KEY=
```

---

## 5. Provider strategy

### 5.1 Two providers, one interface

```ts
export interface AgentProviderAdapter {
  name: AgentProvider;
  run(input: AgentInput): AsyncIterable<AgentEvent>;
}

export type AgentProvider = "claude-cli" | "openrouter";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: unknown; callId: string }
  | { type: "tool_result"; callId: string; result: unknown }
  | { type: "final"; text: string; usage?: unknown }
  | { type: "error"; error: string };
```

### 5.2 Claude CLI provider

Default. Spawns `claude` with the args in §4.3. Records stdout, stderr, exit code, duration, parsed events. Streams text deltas through the Telegram message-editing adapter.

### 5.3 OpenRouter direct provider

Uses native `fetch` (a fake fetch is injectable in tests). Supports:

1. `/chat/completions` (typed method) — primary.
2. `/responses` (typed method, beta/optional).
3. `/models` (typed method).
4. Generic `request<T>()` for every other OpenRouter API path — future-proofs the integration.
5. Streaming and non-streaming.
6. OpenRouter server tools (`openrouter:web_search`, `openrouter:web_fetch`, `openrouter:datetime`, `openrouter:image_generation`) passed through the request `tools` array.
7. App-defined function tools through ToolRegistry.
8. Tool loop with max rounds (default 8).
9. Anthropic-compatible `cache_control: { type: "ephemeral" }` markers at the four documented breakpoint positions (§12) when the model is Anthropic.

---

## 6. Tool system

### 6.1 ToolRegistry

Single registry. All local tools, MCP tools, OpenRouter server tools, Gemini tools, and Anthropic tools register through it or are exposed through it.

```ts
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  source: "builtin" | "mcp" | "openrouter-server" | "anthropic" | "gemini";
};

export interface ToolHandler {
  definition: ToolDefinition;
  execute(input: unknown, ctx: ToolExecutionContext): Promise<unknown>;
}
```

### 6.2 Built-in tools

| Tool name | Purpose |
|---|---|
| `mvpclaw_status` | Health / configured provider |
| `mvpclaw_read_recent_messages` | Read N most recent messages in current chat |
| `mvpclaw_list_skills` | List enabled skills |
| `mvpclaw_read_skill` | Read full body of a skill by name |
| `mvpclaw_datetime` | Current time in chat's timezone |
| `memory_read` | Read runtime or per-chat memory |
| `memory_append` | Append a dated entry to memory (no overwrite/delete) |
| `schedule_task` | Schedule a future or recurring agent run |
| `cancel_task` | Cancel a scheduled task |
| `list_tasks` | List tasks for the current chat |
| `update_task` | Update a task's prompt, schedule, or pause state |

### 6.3 OpenRouter server tools (passthrough only)

When the OpenRouter direct provider is active, MVPClaw passes these through the request — they execute on OpenRouter's side, not locally:

- `openrouter:web_search`
- `openrouter:web_fetch`
- `openrouter:datetime`
- `openrouter:image_generation`

### 6.4 Anthropic web search tool

Local tool `anthropic_web_search`. Calls Anthropic's web search via `@anthropic-ai/sdk`. Disabled unless `ANTHROPIC_API_KEY` is set AND `anthropic.webSearch.enabled = true`.

### 6.5 Gemini research tool

Local tool `gemini_research`. Calls Gemini via `@google/genai`. MAY enable Google Search grounding and URL context when configured. Disabled unless `GEMINI_API_KEY` is set.

### 6.6 MCP exposure of built-in tools

MVPClaw exposes its built-in tools to Claude CLI through an internal MCP server command:

```bash
mvpclaw mcp tools
```

The generated Claude CLI MCP config includes:

```json
{
  "mcpServers": {
    "mvpclaw-tools": {
      "command": "node",
      "args": ["dist/cli/main.js", "mcp", "tools"],
      "env": { "MVPCLAW_CONFIG": "./mvpclaw.config.json" }
    }
  }
}
```

For the OpenRouter direct provider, MCP tools are mapped to OpenRouter function tools: `mcp server tool → JSON Schema function tool → ToolRegistry execute → tool response message`.

---

## 7. Skill system

### 7.1 Format

AgentSkills-compatible folders:

```text
skills/<name>/SKILL.md
skills/<name>/scripts/*
skills/<name>/references/*
skills/<name>/assets/*
```

`SKILL.md` MUST have YAML frontmatter with `name` and `description`:

```markdown
---
name: research
description: Use when the user asks for sourced research, citations, or fact checking.
---

Follow this process...
```

### 7.2 Loading

1. Scan `config.skills.skillsDir` at startup.
2. Validate every `SKILL.md` (frontmatter parses; required keys present).
3. Store skill metadata in SQLite (`skills` table).
4. Sync skills to `~/.mvpclaw/workspaces/default/.claude/skills/` so Claude CLI finds them via its standard discovery.
5. Add skill metadata (frontmatter only) to every prompt — matches Claude Code's progressive-disclosure pattern.
6. Load full skill body only when the user invokes `/skill-name`.

### 7.3 Invocation

A user message beginning with `/skill-name` (e.g. `/research`, `/debugging`) forces that skill into the agent context: the full `SKILL.md` body is injected into the system prompt for that run.

Unknown skill commands respond with a helpful message and do NOT call the model.

---

## 8. MCP exposure

### 8.1 MCP client

MVPClaw consumes external MCP servers declared in `config.mcp.servers`. Required transports:

1. **stdio** — primary, for local commands.
2. **streamable HTTP** — for remote servers.
3. SSE — MAY be supported if the SDK provides it ergonomically.

### 8.2 MCP servers exposed by MVPClaw

Two server commands:

| Command | Exposes |
|---|---|
| `mvpclaw mcp tools` | All built-in tools (§6.2) |
| `mvpclaw mcp conversations` | `conversations_list`, `messages_read`, `messages_send` — lets an external MCP client inspect or send Telegram conversation messages through MVPClaw |

Both are spawned by Claude CLI as stdio MCP servers via the generated MCP config.

---

## 9. SQLite schema

SQLite is the **single source of runtime truth**. WAL mode, `synchronous=NORMAL`, `foreign_keys=ON`. All timestamps are ISO strings unless explicitly named `_at` with `INTEGER` type (unix ms UTC).

### 9.1 Core tables (migration `0001_initial.sql`)

```sql
CREATE TABLE schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_chat_id TEXT NOT NULL,
  thread_id TEXT,
  type TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_chat_id, thread_id)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  direction TEXT NOT NULL,                 -- 'inbound' | 'outbound'
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  provider_update_id TEXT,
  sender_id TEXT,
  text TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_update_id)
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  input_message_id TEXT NOT NULL REFERENCES messages(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL,                    -- 'queued'|'running'|'succeeded'|'failed'
  trace_path TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  tool_name TEXT NOT NULL,
  source TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  run_id TEXT REFERENCES agent_runs(id),
  provider TEXT NOT NULL,
  provider_chat_id TEXT NOT NULL,
  provider_thread_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  error TEXT
);

CREATE TABLE skills (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
```

### 9.2 Tasks table (migration `0003_tasks.sql`)

```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,                 -- ULID
  chat_id         INTEGER NOT NULL,
  created_by      TEXT NOT NULL,                    -- 'user'|'agent'|'system'
  kind            TEXT NOT NULL,                    -- 'one_shot'|'recurring'
  cron_expr       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Vienna',
  next_run_at     INTEGER NOT NULL,                 -- unix ms UTC
  last_run_at     INTEGER,
  prompt          TEXT NOT NULL,
  skill           TEXT,
  state           TEXT NOT NULL DEFAULT 'scheduled',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  catchup_policy  TEXT NOT NULL DEFAULT 'run_once',
  lease_owner     TEXT,
  lease_until     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_tasks_due ON tasks(state, next_run_at);
CREATE INDEX idx_tasks_chat ON tasks(chat_id, state);
```

### 9.3 Proactive columns on `chats` (migration `0004_chats_proactive.sql`)

```sql
ALTER TABLE chats ADD COLUMN chat_blocked          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN last_proactive_send   INTEGER;
ALTER TABLE chats ADD COLUMN proactive_count_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN proactive_count_date  TEXT;
```

### 9.4 Per-chat memory (migration `0005_chat_memory.sql`)

```sql
CREATE TABLE chat_memory (
  chat_id     INTEGER PRIMARY KEY,
  body        TEXT NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE chat_memory_archive (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL,
  body        TEXT NOT NULL,
  archived_at INTEGER NOT NULL
);
```

### 9.5 Schema invariants

1. All external updates have unique IDs (`messages.provider_update_id` UNIQUE).
2. All tool inputs/results stored as JSON strings.
3. Outbox delivery is idempotent (status transitions + `attempts` counter).
4. `tasks.state='running' AND lease_until < now()` rows are reset to `scheduled` on startup.
5. Raw JSON columns are OPTIONAL and MAY be disabled if logs grow too large.

---

## 10. Scheduler & tick loop

### 10.1 Loops

| Loop | Interval | Work |
|---|---|---|
| Fast tick | **1000 ms** | Due-task query, lease acquisition, fan-out; drain outbox |
| Sweep | **60 s** | Catch-up scan, `PRAGMA wal_checkpoint(PASSIVE)`, reap dead-letter tasks, metrics |

**Drift correction:** the tick computes `expected_next = anchor + (n+1) * interval` using `setTimeout` — NOT naive `setInterval`. Node's `setInterval` drifts cumulatively (nodejs/node #21822); this matters over 24h+ uptime.

### 10.2 Task lifecycle

States: `scheduled | running | completed | failed | dead | cancelled | paused`.

```text
scheduled → running (atomic lease)
running   → scheduled (recurring + success → compute next_run_at)
running   → completed (one-shot + success)
running   → failed    (exception, transient)
failed    → scheduled (retries_left > 0 → backoff)
failed    → dead      (retries_left == 0)
scheduled → cancelled (user or agent cancels)
running   → cancelled (best-effort)
```

On restart, `running` rows are reset to `scheduled` with `attempts += 1`. Task implementations MUST be idempotent (or accept at-least-once semantics).

### 10.3 Catch-up policy

`tasks.catchup_policy` column:

| Task type | Policy | Behavior |
|---|---|---|
| One-shot | `run_once` (default) | Run once immediately on restart |
| One-shot | `skip_if_older_than:N` | Skip if older than N seconds |
| Recurring | `run_once` (default) | Run once now, then compute next future occurrence |
| Recurring | `run_all_missed` | Run for each missed occurrence (capped at `MAX_CATCHUP_RUNS=24`) |
| Recurring | `skip` | Compute next future occurrence only |

### 10.4 Graceful shutdown

On `SIGTERM` / `SIGINT`:

1. Set `ctx.shuttingDown = true`.
2. Telegram poller and tick loop refuse new work.
3. Wait for in-flight runs, bounded by `shutdown.drain_ms` (15 s default).
4. Reset `running` tasks back to `scheduled`.
5. Flush outbox, bounded by `shutdown.outbox_ms` (5 s default).
6. `db.close()` (better-sqlite3 deletes WAL/SHM on clean close).
7. `process.exit(0)`.

Hard-kill fallback `setTimeout(() => process.exit(1), shutdown.hard_ms)` (30 s default). Re-entrant safe — a second SIGTERM during shutdown does NOT restart the sequence.

### 10.5 croner usage

croner is used **only** as a parser/calculator:

```ts
new Cron(expr, { timezone }).nextRun(after);
```

Callback-style `new Cron(expr, cb)` is NOT used. The tick loop owns wall-clock timing.

croner is chosen over `node-cron` (DST bugs in timezone option) and `node-schedule` / `bree` (extra processes / threads not needed in a single-process spec).

---

## 11. Proactive policy

Proactive messages (agent-initiated, no immediately preceding inbound) flow only through this path: agent calls `schedule_task` during an active session → row in `tasks` → tick fires it later → outbox.

The agent SHALL NOT initiate proactive messages by any other mechanism.

### 11.1 Telegram platform constraints

- **A bot cannot initiate a conversation.** The user MUST have started the bot. 403 `Forbidden: bot can't initiate conversation with a user` → set `chats.chat_blocked=1` and cancel pending tasks.
- **Per-chat rate limit:** ≈1 message/second.
- **Global broadcast limit:** 30 messages/second.
- **Silent messages:** `sendMessage(disable_notification=true)`.

### 11.2 Config

```json
{
  "proactive": {
    "enabled": true,
    "default_disabled_per_chat": false,
    "max_per_chat_per_day": 5,
    "min_gap_seconds_between": 300,
    "quiet_hours": {
      "enabled": true,
      "start": "22:00",
      "end": "08:00",
      "timezone": "Europe/Vienna",
      "policy": "silent"
    }
  }
}
```

### 11.3 Outbox gates (evaluated in order, short-circuit)

1. `chat_blocked == 1` → drop, log, no retry.
2. `proactive.enabled == false` (resolved with per-chat override) → cancel task.
3. Quiet hours active AND `policy == 'drop'` → cancel task.
4. Quiet hours active AND `policy == 'defer'` → reschedule `next_run_at` to next end-of-quiet + jitter ∈ [0, 600 s].
5. `tasks_sent_today(chat_id) >= max_per_chat_per_day` → cancel task, log.
6. `now() - last_proactive_send(chat_id) < min_gap_seconds_between` → reschedule by deficit + jitter.
7. Quiet hours active AND `policy == 'silent'` → `sendMessage(..., disable_notification=true)`.
8. Otherwise: normal `sendMessage`.

Per-chat policy overrides global config; resolution order: chat policy → global config → built-in defaults.

### 11.4 Daily counter

`chats.proactive_count_today` is reset on the first sweep after midnight in `Europe/Vienna` (or per `quiet_hours.timezone`) when `proactive_count_date` is stale.

---

## 12. Prompt composition

### 12.1 Composition order (deterministic)

For each model call, the composer assembles the request in this exact order, matching Anthropic's documented cache hierarchy (**tools → system → messages**):

```text
1.  Tools block                                  (alphabetical by name)
2.  System messages, in order:
    2a. Static system preamble                   (project identity, role, hard rules)
    2b. Skill fragments                          (frontmatter for all skills + body of forced skill only)
    2c. Tool descriptions appendix               (free-form prose describing tool semantics)
    2d. Project memory                           (prompts/internal-agent/CLAUDE.md → synced workspace copy)
    2e. Agent runtime memory                     (~/.mvpclaw/workspaces/default/CLAUDE.local.md)
    2f. Per-chat memory                          (SQLite chat_memory.body for active chat)
3.  Conversation history                          (sliding window from §13.3)
4.  Current user turn                             (the inbound message)
```

### 12.2 Anthropic cache breakpoints (4 max)

| BP | Position | Purpose |
|---|---|---|
| BP1 | End of Tools block (§12.1 1) | Tools change rarely |
| BP2 | End of §2c | Longest static system+tool prose prefix |
| BP3 | End of §2f | Per-chat static prefix |
| BP4 | (Optional) End of second-to-last assistant turn | Long sessions only |

Static-first, dynamic-last order is required for cache hits.

### 12.3 Forced skill invocation

A user message beginning with `/skill-name`:

1. Orchestrator parses `skill-name` against `ToolRegistry.skills`. Unknown → reply with help; do NOT call the model.
2. Known → corresponding `SKILL.md` body injected at §2b in full (overriding progressive disclosure).
3. Leading `/skill-name ` token stripped from user message before §4.
4. Skill name logged on the assistant turn.

### 12.4 OpenRouter cache behavior

When the active provider is OpenRouter:

- For Anthropic models via OpenRouter → emit `cache_control: { type: "ephemeral" }` at BP1–BP3.
- For non-Anthropic models → no cache markers.
- OpenRouter response caching is **off** by default.

### 12.5 Determinism

Given identical inputs, the composed payload MUST be byte-identical. Rules:

1. Tools list sorted alphabetically by `name`.
2. Stable JSON key ordering (`fast-json-stable-stringify` or equivalent).
3. No timestamps, no random IDs, no environment hashes above the last cache breakpoint.

### 12.6 L0–L9 prompt file hierarchy

| Layer | Path | Owner | Loaded by | Writable by |
|---|---|---|---|---|
| L0 Static preamble | hardcoded in `src/prompts/preamble.ts` | maintainer | composer §2a | source only |
| L1 Project memory (dev) | `./CLAUDE.md` | maintainer | Claude Code dev only | maintainer |
| L2 Project memory (runtime) | `./prompts/internal-agent/CLAUDE.md` → `~/.mvpclaw/workspaces/default/CLAUDE.md` | maintainer | composer §2d | maintainer (sync overwrites) |
| L3 Agent runtime memory | `~/.mvpclaw/workspaces/default/CLAUDE.local.md` | agent | composer §2e | agent (append-only) + user |
| L4 Per-chat memory | SQLite `chat_memory` table | agent + user | composer §2f | agent + user |
| L5 Skill description | `./skills/<name>/SKILL.md` frontmatter | maintainer | composer §2b (always) | maintainer |
| L6 Skill body | `./skills/<name>/SKILL.md` body | maintainer | composer §2b (only when forced) | maintainer |
| L7 Skill references | `./skills/<name>/references/*.md` | maintainer | filesystem tool on demand | maintainer |
| L8 Tool descriptions | generated by `ToolRegistry.describe()` | tool authors | composer §2c | tool authors |
| L9 Human dev local | `./CLAUDE.local.md` (gitignored) | developer | Claude Code dev only | developer |

---

## 13. Agent self-memory

### 13.1 Threat model

Memory written by an LLM and later re-read by the same LLM is a known attack surface (memory poisoning; OWASP LLM08; MINJA paper ≥95% injection success). Mitigation is **structural**, not content detection.

### 13.2 MCP tools (exactly two — no others)

```jsonc
// memory_read
{
  "name": "memory_read",
  "inputSchema": {
    "type": "object",
    "required": ["scope"],
    "properties": { "scope": { "type": "string", "enum": ["runtime", "chat"] } }
  }
}

// memory_append (append-only, max 2000 chars per call, dated)
{
  "name": "memory_append",
  "inputSchema": {
    "type": "object",
    "required": ["scope", "text"],
    "properties": {
      "scope": { "type": "string", "enum": ["runtime", "chat"] },
      "text":  { "type": "string", "minLength": 1, "maxLength": 2000 }
    }
  }
}
```

No `memory_write`. No `memory_delete`. No `memory_replace`. Full rewrite or deletion is ONLY via the human-facing CLI:

```bash
mvpclaw memory show   [--scope runtime|chat --chat-id <id>]
mvpclaw memory edit   [--scope runtime|chat --chat-id <id>]
mvpclaw memory clear  [--scope runtime|chat --chat-id <id>]
```

### 13.3 Append format

```
## <ISO 8601 UTC timestamp>
<sanitized text>

```

Implementation: `body = body + entry`. Append is via `fs.appendFile` (runtime) or DB transaction (per-chat). Both paths hold an in-process mutex during write.

### 13.4 Limits & rotation

| Limit | Default | Rationale |
|---|---|---|
| `max_append_chars` | 2000 | ~500 tokens; cache-friendly |
| `max_file_chars` (runtime) | 200000 | ~50K tokens |
| `max_chat_chars` (per-chat) | 50000 | ~12K tokens |
| Rotation `keep_last_chars_runtime` | 100000 | Move older entries to `CLAUDE.local.md.archive.md` |
| Rotation `keep_last_chars_chat` | 25000 | Move to `chat_memory_archive` table |

Rotation runs inside the same mutex as append.

### 13.5 Redactor

Before write, text passes through a redactor that masks:

1. `(?i)(api[-_ ]?key|secret|token|bearer|password)\s*[:=]\s*\S+` → `<redacted-secret>`
2. Base64 of length ≥ 32 → `<redacted-base64>`
3. Provider key prefixes (`sk-`, `sk-or-`, `ghp_`, `xoxb-`, ...) length ≥ 20 → `<redacted-key>`
4. Telegram bot token shape `\d{8,12}:[A-Za-z0-9_-]{30,}` → `<redacted-tg-token>`

The redactor is a defensive net, NOT a guarantee. **Memory MUST NOT be used to store secrets.**

---

## 14. CLAUDE.md hierarchy

Four distinct CLAUDE.md files. Mixing them up is the single most common mistake.

| # | Path | Owner | Committed | Edited by runtime agent |
|---|---|---|---|---|
| 1 | `./CLAUDE.md` | maintainer | YES | no |
| 2 | `./prompts/internal-agent/CLAUDE.md` (source) → `~/.mvpclaw/workspaces/default/CLAUDE.md` (runtime copy) | maintainer | YES (source only) | no |
| 3 | `~/.mvpclaw/workspaces/default/CLAUDE.local.md` | runtime agent (via `memory_append`) | NO | YES (append-only) |
| 4 | `./CLAUDE.local.md` | human developer | NO | never |

### 14.1 Workspace sync

On every boot (and on SIGHUP if implemented):

```text
if mtime(prompts/internal-agent/CLAUDE.md) > mtime(~/.mvpclaw/workspaces/default/CLAUDE.md):
    copy prompts/internal-agent/CLAUDE.md → ~/.mvpclaw/workspaces/default/CLAUDE.md
```

`CLAUDE.local.md` is NEVER overwritten by the sync (it's a different file).

### 14.2 Claude CLI working directory

Claude CLI MUST be spawned with `cwd = ~/.mvpclaw/workspaces/default`, NOT the repo root. Otherwise the Telegram agent reads the maintainer's `./CLAUDE.md` (project rules for the dev agent) instead of its own identity prompt.

This is the single most important rule for keeping the runtime agent clean and isolated.

---

## 15. Install model

**MVPClaw is a template repository, not a CLI tool.** Installation = `git clone` + open the folder with Claude Code (or Codex CLI) + tell the agent "make this work". The agent reads `CLAUDE.md`, follows `INSTALL.md`, and performs every step.

### 15.1 Canonical user journey

```bash
git clone https://github.com/Arthur-Ficial/mvpclaw.git mybot
cd mybot
claude
> hey claude, make this work
```

The agent then:

1. Reads `./CLAUDE.md`.
2. Follows pointer to `./INSTALL.md`.
3. Asks ≤ 6 questions (project name, install mode, deployment, provider, Telegram token, OpenRouter key).
4. Renames the project (`package.json` name, README heading) — but NOT internal module names.
5. Handles git identity (independent: detach `origin`; fork: rename to `mvpclaw-upstream`, push-disabled).
6. Writes `.env` with the user's tokens.
7. Copies `mvpclaw.config.example.json` → `mvpclaw.config.json`.
8. Runs `pnpm install`, applies migrations, runs `pnpm check`.
9. Starts the bot and prompts the user to test `/start` from Telegram.
10. Writes `.mvpclaw-install.json` (committed) so future agent sessions skip install.

### 15.2 Four design decisions

| Decision | Choice | Implication |
|---|---|---|
| Git identity | Independent (default) or Fork | Two independent installs share no git history |
| Secrets | `.env` file, gitignored | One place; Docker reads via `env_file` |
| Deployment | Local (default) + Docker (optional) | No systemd in MVP |
| Agent shell access | Automated (default) or Lockdown (writes `install-commands.sh`) | Lockdown triggered by `.mvpclaw-lockdown` marker or user request |

### 15.3 Lockdown mode

When `.mvpclaw-lockdown` exists OR the user says "lockdown", the agent:

1. Writes every file the playbook says to write.
2. Generates `install-commands.sh` with every shell command in order.
3. Does NOT execute anything.
4. Prints: "Review `install-commands.sh`, then run `bash install-commands.sh`."

`install-commands.sh` is gitignored — regenerate-on-demand, not source.

### 15.4 `.mvpclaw-install.json` (committed)

```json
{
  "installedAt": "<ISO 8601 UTC>",
  "installedBy": "claude-code | codex | other",
  "projectName": "<PROJECT_NAME>",
  "mode": "independent | fork",
  "deployment": "local | docker",
  "provider": "claude-cli | openrouter",
  "mvpclawTemplateCommit": "<HEAD SHA before agent changes>",
  "lockdown": false
}
```

Future agent sessions read this file to determine "this is installed, don't re-run install."

---

## 16. Test regime

### 16.1 Stack

Vitest for unit, integration, and e2e. No Jest. No Mocha. One runner.

### 16.2 Categories

**Unit (`tests/unit/`):** config loading + env substitution, config redaction, Telegram message normalization, Telegram chunking, skill validation, skill command parsing, prompt builder, OpenRouter request builder, Claude CLI event parser, ToolRegistry registration/execution, outbox state transitions, scheduler tick drift, lifecycle state transitions, catch-up policy, croner DST handling, memory append/rotation/redaction, prompt composition determinism, sliding window truncation.

**Integration (`tests/integration/`):** SQLite repositories with temp DB, migrations apply cleanly, fake Telegram adapter writes outbound messages, fake OpenRouter HTTP server handles chat completion, fake Claude CLI executable returns stream-json fixtures, MCP tools server exposes built-in tools, skill sync writes `.claude/skills`, atomic task lease via UPDATE+changes(), per-chat memory isolation.

**E2E (`tests/e2e/`):** synthetic Telegram update → fake Claude CLI → outbox reply; `/skills` command → no model call; `/research topic` → forced skill included in run trace; OpenRouter direct provider → fake HTTP tool call loop → final reply; MCP tool exposed to fake Claude CLI → tool call logged; duplicate Telegram update → no duplicate run; SIGTERM mid-tick → in-flight task requeued; 1-min one-shot fires within ±1 s.

### 16.3 `pnpm check` — the single gate

```json
{
  "scripts": {
    "dev": "tsx src/cli/main.ts start",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run tests/unit tests/integration",
    "test:watch": "vitest",
    "test:e2e": "vitest run tests/e2e",
    "check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e && pnpm build"
  }
}
```

A change SHALL NOT be accepted unless `pnpm check` passes. Business logic SHALL have tests. Adapters SHALL have fake/contract tests. Every bug fix SHALL add or update a failing test first.

---

## 17. Logging & tracing

### 17.1 Pino JSON logs

Every log event SHOULD include:

1. `requestId`
2. `runId` (when available)
3. `sessionId` (when available)
4. `chatId` (when available)
5. `component`

Secrets are redacted via Pino's `redact` option. The redaction list is built from `config.logging.redact`.

### 17.2 Trace files

Every agent run writes a JSONL trace:

```text
data/traces/<runId>.jsonl
```

Trace event types:

1. `inbound_message_received`
2. `prompt_built`
3. `provider_started`
4. `provider_event`
5. `tool_call_started`
6. `tool_call_finished`
7. `outbox_created`
8. `provider_finished`
9. `run_failed`

All trace files MUST redact secrets.

### 17.3 Debug CLI

```bash
mvpclaw status
mvpclaw doctor                       # health-check all providers + config
mvpclaw debug run <runId>            # resolved provider, prompt path, MCP config, tool calls
mvpclaw replay <runId>               # re-run the same prompt without Telegram
mvpclaw skills list
mvpclaw mcp list
mvpclaw telegram test
mvpclaw tasks list [--state ...] [--include-completed] [--include-dead]
mvpclaw tasks show <task_id>
mvpclaw tasks cancel|pause|resume <task_id>
mvpclaw memory show|edit|clear [--scope runtime|chat --chat-id <id>]
mvpclaw memory archive list [--scope ...]
```

---

## 18. Security posture

Security is **not** the focus of MVP, but these MUST be implemented:

1. Secrets never logged (Pino redaction).
2. Secrets never stored in prompt text.
3. Telegram sender allowlist by default (`config.telegram.allowedUserIds`).
4. Group replies only on mention/command by default (`replyMode: "dm-and-mentioned-groups"`).
5. Tool calls logged.
6. Dangerous Claude CLI tools NOT in default allowlist.
7. No `--dangerously-skip-permissions` in default config.
8. No shell execution except through Claude CLI permissions explicitly configured by the user.

**Explicit non-goals:**

- No sandboxing (no Firejail, no Docker confinement beyond what the user adds).
- No RBAC.
- No audit logging beyond Pino + trace JSONL.
- No rate limiting beyond Telegram's own per-chat limit.

---

## 19. Acceptance criteria

MVPClaw v1.0 is accepted when ALL of these are true:

1. `pnpm check` passes on a fresh install with valid keys.
2. `mvpclaw doctor` passes with fake/test config.
3. A fake Telegram update triggers a single agent run.
4. The result is written to outbox.
5. The outbox sends through the fake Telegram adapter.
6. Duplicate Telegram update does NOT create a second run.
7. Claude CLI bridge is tested through a fake executable.
8. OpenRouter direct provider is tested through a fake HTTP server.
9. Skills are loaded from `skills/*/SKILL.md`.
10. `/skill-name` forces skill usage.
11. Built-in tools are exposed through `mvpclaw mcp tools`.
12. Conversation tools are exposed through `mvpclaw mcp conversations`.
13. Trace JSONL exists for every agent run.
14. Secrets are redacted from logs and trace files.
15. `git clone` → `claude` → "make this work" → working bot in <10 minutes of human time.
16. The bot replies to `/start` within 60 seconds of `pnpm dev` starting.
17. Two independent-mode clones share no git history.
18. `.env` is never committed.
19. `.mvpclaw-install.json` IS committed.
20. 24-hour soak: tick drift ≤ 100 ms, no leaked `running` task rows, Anthropic cache hit rate ≥ 50 %.
21. TypeScript strict, ESLint clean, Prettier clean, all tests green.
22. No framework, service, or directory exists without a test or clear reason.

---

## Cross-reference

This document consolidates the following source specifications (maintainer's local copies, not committed to this repo):

- `01_RESEARCH_openclaw_nanoclaw_brief.md` — platform fact base
- `02_MVPClaw_SPEC.md` v0.1.0 — main architecture (§§1–25 above derive from §§1–24 here)
- `03_MVPClaw_INSTALL_original.md` — superseded by 06
- `04_CLAUDE_md_hierarchy.md` — source of §14
- `05_MVPClaw_SPEC_ADDENDUM.md` v0.2.0 — runtime extension (§§10–13, parts of §16, §12 above)
- `06_MVPClaw_INSTALL_SYSTEM.md` — source of §15

If the maintainer wishes to publish the briefing alongside the repo in a future release, those documents take precedence over any text here in cases of conflict.
