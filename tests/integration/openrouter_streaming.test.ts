import { describe, it, expect } from 'vitest';
import { OpenRouterClient } from '../../src/agent/index.js';

/**
 * OpenRouter streaming SSE — real-provider smoke test. NO FAKES.
 * Skipped when OPENROUTER_API_KEY is unset. May skip its assertions on a
 * 403 "Key limit exceeded" (billing cap) — we still validate the parser
 * survives the stream lifecycle.
 */
const key = process.env['OPENROUTER_API_KEY'];
const skip = !key || key.length < 20;

describe.skipIf(skip)('OpenRouter streaming — real SSE smoke', () => {
  it('yields at least one chunk with content or a clean billing error', async () => {
    const client = new OpenRouterClient({
      apiKey: key as string,
      baseUrl: 'https://openrouter.ai/api/v1',
      title: 'mvpclaw-integration-tests',
    });
    let chunkCount = 0;
    let text = '';
    try {
      for await (const chunk of client.chatCompletionsStream({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Reply with exactly the word OK.' },
          { role: 'user', content: 'OK?' },
        ],
      })) {
        chunkCount++;
        const c = chunk.choices[0]?.delta.content ?? '';
        text += c;
      }
      expect(chunkCount).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
    } catch (err) {
      // Billing cap or rate limit is acceptable evidence that the request
      // shape made it to OpenRouter unchanged.
      expect(String(err)).toMatch(/40[39]|Key limit|rate/i);
    }
  }, 60_000);
});
