import { describe, it, expect } from 'vitest';
import { chunkText } from '../../src/channels/telegram.format.js';

/**
 * P3 unit tests for code-fence-aware text chunking.
 *
 * The spec (briefing/02_MVPClaw_SPEC.md §12.3) requires:
 *   - Chunks ≤ maxMessageChars (default 3900).
 *   - Don't split inside a code fence when avoidable.
 *   - When unavoidable, close-and-reopen the fence so each chunk is
 *     independently well-formed Markdown.
 */
describe('chunkText — code-fence-aware splitting', () => {
  it('returns the input unchanged when ≤ maxChars', () => {
    const out = chunkText('hello', 10);
    expect(out).toEqual(['hello']);
  });

  it('splits a long plain text at a whitespace boundary', () => {
    const text = 'word '.repeat(20); // 100 chars
    const chunks = chunkText(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(40); // small slack for fence-close insertion (none here)
    }
    // Reassembly preserves the original (modulo fence decoration which is none here).
    expect(chunks.join('')).toBe(text);
  });

  it('prefers paragraph break (\\n\\n) over a mid-paragraph cut', () => {
    const text = [
      'paragraph one is short.',
      '',
      'paragraph two has more content here to push us past the limit.',
    ].join('\n');
    const chunks = chunkText(text, 30);
    // The first chunk should END right after the empty line (paragraph break).
    expect(chunks[0]).toContain('paragraph one is short.');
    expect(chunks[0]).not.toContain('paragraph two');
  });

  it('closes and reopens a code fence when forced to split inside one', () => {
    const lang = 'ts';
    // Make the fenced block itself larger than maxChars so we're forced inside.
    const inner = Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const text = '```' + lang + '\n' + inner + '\n```';
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // The first chunk must end with a closing fence line.
    expect(chunks[0]).toMatch(/```\s*$/);
    // The second chunk must start with an opening fence for the SAME language.
    expect(chunks[1]).toMatch(new RegExp('^```' + lang));
    // Every chunk independently has balanced fences.
    for (const c of chunks) {
      const fenceCount = (c.match(/^```/gm) ?? []).length;
      expect(fenceCount % 2, `unbalanced fences in chunk: ${c}`).toBe(0);
    }
  });

  it('does NOT close-and-reopen when the natural split is outside any fence', () => {
    const text = 'plain text here that fits.\n\n```ts\nshort fenced\n```\n\nmore plain text';
    const chunks = chunkText(text, 1000);
    // Whole thing fits — single chunk.
    expect(chunks).toEqual([text]);
  });

  it('handles multiple consecutive code fences', () => {
    const block = '```js\n' + 'x = 1;\n'.repeat(20) + '```';
    const text = block + '\n\n' + block + '\n\n' + block;
    const chunks = chunkText(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const fenceCount = (c.match(/^```/gm) ?? []).length;
      expect(fenceCount % 2).toBe(0);
    }
  });

  it('produces no chunk that exceeds maxChars by more than a fence-close decoration', () => {
    // Fence close decoration is at most "\n```\n" = 5 chars; allow a small slack.
    const text = 'a '.repeat(5000); // 10K chars of plain text
    const chunks = chunkText(text, 1000);
    for (const c of chunks) {
      expect(c.length, `chunk too big: ${c.length}`).toBeLessThanOrEqual(1010);
    }
  });

  it('terminates even on pathological input (very long single token)', () => {
    const text = 'x'.repeat(50_000); // no whitespace at all
    const chunks = chunkText(text, 1000);
    expect(chunks.length).toBeGreaterThan(40);
    // Concatenation is the original (no fence decoration on plain text).
    expect(chunks.join('')).toBe(text);
  });
});
