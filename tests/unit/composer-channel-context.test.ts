/**
 * Composer test for the channel-context section (commit 6125b10).
 *
 * Pins the behaviour that the bot's system prompt includes its current
 * external chat id, so tools like `telegram_photo` don't have to ask the
 * user. Before this section existed, every photo request looped on
 * "what's your chat id?".
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, applyMigrations } from '../../src/db/index.js';
import { composePrompt } from '../../src/prompts/index.js';
import { createToolRegistry, type ToolRegistry } from '../../src/tools/index.js';

function freshDb(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  applyMigrations(db, resolve(__dirname, '../../migrations'));
  return db;
}

function emptyTools(): ToolRegistry {
  return createToolRegistry();
}

describe('composePrompt — channel context section', () => {
  // The literal "## Channel context" header also appears in the project's
  // system-prompt file (as documentation), so we anchor on the unique
  // injected key:value line "- external chat id: <id>".
  it('omits the injected chat-id line when no channelContext is passed', () => {
    const db = freshDb();
    const out = composePrompt({
      systemPromptFile: resolve(__dirname, '../../prompts/internal-agent/CLAUDE.md'),
      skills: [],
      history: [],
      userText: 'hi',
      db,
      tools: emptyTools(),
    });
    expect(out.systemPrompt).not.toMatch(/- external chat id: \d+/);
  });

  it('injects the chat-id line when channelContext is provided', () => {
    const db = freshDb();
    const out = composePrompt({
      systemPromptFile: resolve(__dirname, '../../prompts/internal-agent/CLAUDE.md'),
      skills: [],
      history: [],
      userText: 'hi',
      channelContext: { channel: 'telegram', providerChatId: '1234567890' },
      db,
      tools: emptyTools(),
    });
    expect(out.systemPrompt).toContain('- channel: telegram');
    expect(out.systemPrompt).toContain('- external chat id: 1234567890');
    expect(out.systemPrompt).toContain('Never ask the user');
  });

  it('a different external chat id produces a different prompt (per-turn variability)', () => {
    const db = freshDb();
    const a = composePrompt({
      systemPromptFile: resolve(__dirname, '../../prompts/internal-agent/CLAUDE.md'),
      skills: [],
      history: [],
      userText: 'hi',
      channelContext: { channel: 'telegram', providerChatId: '111' },
      db,
      tools: emptyTools(),
    });
    const b = composePrompt({
      systemPromptFile: resolve(__dirname, '../../prompts/internal-agent/CLAUDE.md'),
      skills: [],
      history: [],
      userText: 'hi',
      channelContext: { channel: 'telegram', providerChatId: '222' },
      db,
      tools: emptyTools(),
    });
    expect(a.systemPrompt).not.toBe(b.systemPrompt);
    expect(a.systemPrompt).toContain('external chat id: 111');
    expect(b.systemPrompt).toContain('external chat id: 222');
  });
});
