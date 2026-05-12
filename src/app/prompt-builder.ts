/**
 * Prompt builder v1.
 *
 * Minimal version: stitches the static preamble + the internal-agent
 * CLAUDE.md content (read on first call, cached for the process) + a
 * tool/skill summary into a single system prompt. P15 (ticket #21)
 * replaces this with the deterministic 9-section composer + Anthropic
 * cache breakpoints.
 *
 * Inputs are pure data; the builder is a pure function — easy to test
 * and easy to reason about.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatMessage, LoadedSkill } from '../agent/index.js';

/** The hardcoded L0 preamble — the bot's role in one paragraph. */
const PREAMBLE = `You are MVPClaw, a single-agent chat assistant. Reply concisely. Use tools when they help; otherwise answer directly. Never invent facts; say "I don't know" when you don't.`;

/** Inputs to `buildPromptV1()`. */
export interface PromptBuilderInput {
  /** Path to the internal-agent CLAUDE.md (the bot's identity file). */
  systemPromptFile: string;
  /** Currently loaded skills (metadata only). */
  skills: readonly LoadedSkill[];
  /** Recent history (chronological). The current user turn is NOT in here. */
  history: readonly ChatMessage[];
  /** The inbound user message text. */
  userText: string;
}

/** Output of `buildPromptV1()`. */
export interface PromptBuilderOutput {
  /** Assembled system prompt for the provider. */
  systemPrompt: string;
  /** Chronological chat history (provider gets this as the `messages` array). */
  history: readonly ChatMessage[];
  /** The user's inbound message. */
  userText: string;
}

/**
 * Build a v1 system prompt.
 *
 * Output format (sections separated by a blank line):
 *   1. The L0 preamble (the bot's role).
 *   2. The internal-agent CLAUDE.md body, when the file exists.
 *   3. A "Skills (metadata only)" section listing enabled skills.
 *
 * @param input - The system-prompt source + history + user text.
 * @returns The composed `PromptBuilderOutput`.
 */
export function buildPromptV1(input: PromptBuilderInput): PromptBuilderOutput {
  const parts: string[] = [PREAMBLE];
  const resolved = resolve(input.systemPromptFile);
  if (existsSync(resolved)) {
    const body = readFileSync(resolved, 'utf8').trim();
    if (body.length > 0) {
      parts.push(body);
    }
  }
  const enabledSkills = input.skills.filter((s) => s.enabled);
  if (enabledSkills.length > 0) {
    const lines = ['## Skills (metadata only)'];
    for (const s of enabledSkills) {
      lines.push(`- ${s.name}: ${s.description}`);
    }
    parts.push(lines.join('\n'));
  }
  return {
    systemPrompt: parts.join('\n\n'),
    history: input.history,
    userText: input.userText,
  };
}
