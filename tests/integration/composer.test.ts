import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyMigrations, openDb, ChatMemoryRepo, ChatsRepo, type Db } from '../../src/db/index.js';
import { composePrompt, truncateHistory, PREAMBLE } from '../../src/prompts/index.js';
import { createToolRegistry, type ToolRegistry } from '../../src/tools/index.js';
import type { ToolHandler } from '../../src/tools/tool.js';

const MIGRATIONS = resolve(__dirname, '../../migrations');

/**
 * Composer determinism + sliding-window tests.
 *
 * These cover the P15 contract: byte-identical output for identical inputs,
 * tools alphabetised, breakpoints at the right places, sliding window
 * truncating from the head.
 */

function mkTool(name: string, description: string): ToolHandler {
  return {
    definition: {
      name,
      description,
      inputSchema: { type: 'object' },
      source: 'builtin',
      enabled: true,
    },
    async execute() {
      return { ok: true };
    },
  };
}

describe('composer — deterministic prompt assembly', () => {
  let tmp: string;
  let db: Db;
  let promptFile: string;
  let tools: ToolRegistry;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-composer-'));
    db = openDb(join(tmp, 'db.sqlite'));
    applyMigrations(db, MIGRATIONS);
    promptFile = join(tmp, 'CLAUDE.md');
    writeFileSync(promptFile, '# Bot identity\n\nBe helpful.\n', 'utf8');

    tools = createToolRegistry();
    tools.register(mkTool('zebra_tool', 'Z tool'));
    tools.register(mkTool('alpha_tool', 'A tool'));
    tools.register(mkTool('middle_tool', 'M tool'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('emits sections in spec order with the L0 preamble first', () => {
    const out = composePrompt({
      systemPromptFile: promptFile,
      skills: [],
      history: [],
      userText: 'hi',
      db,
      tools,
    });
    expect(out.systemPrompt.startsWith(PREAMBLE)).toBe(true);
    expect(out.systemPrompt).toContain('## Tools');
    expect(out.systemPrompt).toContain('## Project memory');
    expect(out.systemPrompt).toContain('# Bot identity');
  });

  it('sorts tools alphabetically (stable across runs)', () => {
    const a = composePrompt({
      systemPromptFile: promptFile,
      skills: [],
      history: [],
      userText: 'x',
      db,
      tools,
    });
    const b = composePrompt({
      systemPromptFile: promptFile,
      skills: [],
      history: [],
      userText: 'x',
      db,
      tools,
    });
    expect(a.tools.map((t) => t.name)).toEqual(['alpha_tool', 'middle_tool', 'zebra_tool']);
    expect(a.tools).toEqual(b.tools);
    expect(a.systemPrompt).toBe(b.systemPrompt);
  });

  it('byte-identical output for identical inputs (determinism)', () => {
    const inputs = {
      systemPromptFile: promptFile,
      skills: [
        { name: 'research', description: 'do research', path: '/x', enabled: true },
        { name: 'debugging', description: 'debug bugs', path: '/y', enabled: true },
      ],
      history: [
        { role: 'user' as const, content: 'earlier 1' },
        { role: 'assistant' as const, content: 'earlier 2' },
      ],
      userText: 'now',
      db,
      tools,
    };
    const a = composePrompt(inputs);
    const b = composePrompt(inputs);
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.tools).toEqual(b.tools);
    expect(a.breakpoints).toEqual(b.breakpoints);
  });

  it('includes per-chat memory body when chat_id is provided', () => {
    const chat = ChatsRepo.upsertChat(db, {
      provider: 'cli-inject',
      provider_chat_id: 'c1',
      type: 'private',
    });
    ChatMemoryRepo.setChatMemory(db, chat.id, 'remembers liking pancakes');
    const out = composePrompt({
      systemPromptFile: promptFile,
      skills: [],
      history: [],
      userText: 'breakfast?',
      chatId: chat.id,
      db,
      tools,
    });
    expect(out.systemPrompt).toContain('Per-chat memory');
    expect(out.systemPrompt).toContain('pancakes');
  });

  it('breakpoint indices point at section boundaries', () => {
    const out = composePrompt({
      systemPromptFile: promptFile,
      skills: [],
      history: [],
      userText: 'hi',
      db,
      tools,
    });
    expect(out.breakpoints.afterTools).toBe(0);
    expect(out.breakpoints.afterToolDescriptions).toBeGreaterThan(0);
    expect(out.breakpoints.afterPerChatMemory).toBe(out.systemPrompt.length);
    expect(out.breakpoints.afterToolDescriptions).toBeLessThanOrEqual(
      out.breakpoints.afterPerChatMemory,
    );
  });

  it('skips disabled tools', () => {
    const r = createToolRegistry();
    r.register({
      definition: {
        name: 'enabled_tool',
        description: 'E',
        inputSchema: { type: 'object' },
        source: 'builtin',
        enabled: true,
      },
      async execute() {
        return null;
      },
    });
    r.register({
      definition: {
        name: 'disabled_tool',
        description: 'D',
        inputSchema: { type: 'object' },
        source: 'anthropic',
        enabled: false,
      },
      async execute() {
        return null;
      },
    });
    const out = composePrompt({
      systemPromptFile: promptFile,
      skills: [],
      history: [],
      userText: 'x',
      db,
      tools: r,
    });
    expect(out.tools.map((t) => t.name)).toEqual(['enabled_tool']);
    expect(out.systemPrompt).not.toContain('disabled_tool');
  });
});

describe('truncateHistory — sliding window', () => {
  it('drops oldest messages when count cap exceeded', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    const r = truncateHistory(history, { windowMessages: 10, windowTokens: 1_000_000 });
    expect(r.history.length).toBe(10);
    expect(r.dropped).toBe(40);
    expect(r.history[0]?.content).toBe('m40');
  });

  it('drops oldest messages when token cap exceeded', () => {
    const history = Array.from({ length: 5 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(400),
    }));
    const r = truncateHistory(history, { windowMessages: 100, windowTokens: 200 });
    expect(r.history.length).toBeLessThan(5);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.approxTokens).toBeLessThanOrEqual(200);
  });

  it('no-op when within both caps', () => {
    const history = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
    ];
    const r = truncateHistory(history, { windowMessages: 40, windowTokens: 24_000 });
    expect(r.history.length).toBe(2);
    expect(r.dropped).toBe(0);
  });
});
