/**
 * Deterministic prompt composer (spec §30 / §31).
 *
 * Replaces `buildPromptV1`. Given identical inputs (config, files, SQLite
 * rows, inbound), produces a byte-identical payload. Section order:
 *
 *   1. Tools block (alphabetical, JSON-stable)
 *   2a. Static preamble (L0)
 *   2b. Skill fragments (frontmatter for all; full body when forced)
 *   2c. Tool descriptions appendix (free-text)
 *   2d. Project memory (synced workspace CLAUDE.md, or the in-repo source)
 *   2e. Agent runtime memory (~/.mvpclaw/workspaces/default/CLAUDE.local.md)
 *   2f. Per-chat memory (SQLite chat_memory.body)
 *   3.  Conversation history (sliding window)
 *   4.  Current user turn
 *
 * Cache breakpoints (Anthropic + Anthropic-via-OpenRouter only) at
 * BP1 (end of tools), BP2 (end of 2c), BP3 (end of 2f).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ChatMessage, LoadedSkill } from '../agent/index.js';
import { ChatMemoryRepo, type Db } from '../db/index.js';
import type { ToolRegistry } from '../tools/index.js';

/** Hardcoded L0 preamble (spec §30.1 2a). */
export const PREAMBLE =
  'You are MVPClaw, a single-agent chat assistant. Reply concisely. Use tools when they help; otherwise answer directly. Never invent facts; say "I don\'t know" when you don\'t.';

/** Input to `composePrompt()`. */
export interface ComposeInput {
  systemPromptFile: string;
  skills: readonly LoadedSkill[];
  forcedSkillName?: string | undefined;
  history: readonly ChatMessage[];
  userText: string;
  chatId?: string | undefined;
  db: Db;
  tools: ToolRegistry;
}

/** Output of `composePrompt()`. */
export interface ComposeOutput {
  /** Composed system prompt — sections 2a–2f concatenated with stable separators. */
  systemPrompt: string;
  /** Conversation history (sliding window already applied by caller). */
  history: readonly ChatMessage[];
  /** Inbound user turn. */
  userText: string;
  /** Alphabetical, JSON-stable tool list — section 1. */
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  /** Indices into `systemPrompt` of the four cache-breakpoint anchors. */
  breakpoints: {
    afterTools: number;
    afterToolDescriptions: number;
    afterPerChatMemory: number;
  };
}

/**
 * Compose a deterministic prompt.
 *
 * @param input - Sources of every section.
 * @returns A `ComposeOutput` where byte-identical inputs produce
 *          byte-identical output.
 */
export function composePrompt(input: ComposeInput): ComposeOutput {
  // 1. Tools block — alphabetical by name; only enabled tools.
  const toolList = input.tools
    .describe()
    .filter((d) => d.enabled)
    .map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // 2a. L0 preamble.
  const sections: string[] = [PREAMBLE];

  // 2b. Skill fragments — frontmatter for all enabled; full body for forced.
  const enabledSkills = input.skills.filter((s) => s.enabled);
  if (enabledSkills.length > 0) {
    const lines = ['## Skills (frontmatter)'];
    for (const s of enabledSkills) {
      lines.push(`- ${s.name}: ${s.description}`);
    }
    sections.push(lines.join('\n'));
  }
  if (input.forcedSkillName) {
    const forced = enabledSkills.find((s) => s.name === input.forcedSkillName);
    if (forced && existsSync(forced.path)) {
      sections.push(
        `## Skill forced: ${forced.name}\n\n${readFileSync(forced.path, 'utf8').trim()}`,
      );
    }
  }

  // 2c. Tool descriptions appendix (free-text).
  if (toolList.length > 0) {
    const lines = ['## Tools'];
    for (const t of toolList) {
      lines.push(`- ${t.name}: ${t.description}`);
    }
    sections.push(lines.join('\n'));
  }
  const afterToolDescriptions = sections.join('\n\n').length;

  // 2d. Project memory.
  const projPath = resolve(input.systemPromptFile);
  if (existsSync(projPath)) {
    const body = readFileSync(projPath, 'utf8').trim();
    if (body.length > 0) {
      sections.push(`## Project memory\n\n${body}`);
    }
  }

  // 2e. Agent runtime memory.
  const runtimePath = resolve(homedir(), '.mvpclaw', 'workspaces', 'default', 'CLAUDE.local.md');
  if (existsSync(runtimePath)) {
    const body = readFileSync(runtimePath, 'utf8').trim();
    if (body.length > 0) {
      sections.push(`## Runtime memory\n\n${body}`);
    }
  }

  // 2f. Per-chat memory.
  if (input.chatId !== undefined) {
    const body = ChatMemoryRepo.readChatMemory(input.db, input.chatId).trim();
    if (body.length > 0) {
      sections.push(`## Per-chat memory (chat_id=${input.chatId})\n\n${body}`);
    }
  }

  const systemPrompt = sections.join('\n\n');
  const afterPerChatMemory = systemPrompt.length;
  // The "tools block" itself is the JSON serialization of `toolList`; the
  // breakpoint AFTER it is at the start of the system messages.
  const afterTools = 0;

  return {
    systemPrompt,
    history: input.history,
    userText: input.userText,
    tools: toolList,
    breakpoints: { afterTools, afterToolDescriptions, afterPerChatMemory },
  };
}
