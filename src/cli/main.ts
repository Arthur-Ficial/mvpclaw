#!/usr/bin/env node
/**
 * MVPClaw CLI entrypoint.
 *
 * Citty-driven dispatcher. Each sub-command lives in `src/cli/cmd/<name>.cmd.ts`
 * and is wired here. The CLI is the project's first-class, Unix-style surface —
 * see `CLAUDE.md` §"CLI-first / AI-steerable" for the contract.
 *
 * The 16 top-level sub-commands listed under `subCommands` below cover every
 * agent capability (per `ARCHITECTURE.md` §1bis). At Phase 1.3 most are stubs
 * that exit 3 with a clear "not yet implemented (ticket Cn / #m)" message;
 * later phases fill them in.
 *
 * Universal flags (`--json`, `--quiet`, `--verbose`, `--config`) are accepted
 * by every sub-command and resolved via `src/cli/output.ts`.
 */
import './load-env.js';
import { defineCommand, runMain } from 'citty';
import { agentCmd } from './cmd/agent.cmd.js';
import { chatCmd } from './cmd/chat.cmd.js';
import { configCmd } from './cmd/config.cmd.js';
import { dbCmd } from './cmd/db.cmd.js';
import { doctorCmd } from './cmd/doctor.cmd.js';
import { mcpCmd } from './cmd/mcp.cmd.js';
import { memoryCmd } from './cmd/memory.cmd.js';
import { outboxCmd } from './cmd/outbox.cmd.js';
import { replayCmd } from './cmd/replay.cmd.js';
import { sendCmd } from './cmd/send.cmd.js';
import { skillCmd } from './cmd/skill.cmd.js';
import { startCmd } from './cmd/start.cmd.js';
import { statusCmd } from './cmd/status.cmd.js';
import { taskCmd } from './cmd/task.cmd.js';
import { toolCmd } from './cmd/tool.cmd.js';
import { traceCmd } from './cmd/trace.cmd.js';

const main = defineCommand({
  meta: {
    name: 'mvpclaw',
    version: '0.0.0-dev',
    description:
      'Telegram-to-AI-agent bridge with a CLI-first, AI-steerable surface. Run `mvpclaw <sub> --help`.',
  },
  subCommands: {
    send: sendCmd,
    outbox: outboxCmd,
    chat: chatCmd,
    agent: agentCmd,
    tool: toolCmd,
    task: taskCmd,
    memory: memoryCmd,
    skill: skillCmd,
    mcp: mcpCmd,
    db: dbCmd,
    trace: traceCmd,
    config: configCmd,
    doctor: doctorCmd,
    status: statusCmd,
    replay: replayCmd,
    start: startCmd,
  },
});

runMain(main);
