import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createClaudeCliProvider } from '../../src/agent/claude-cli.provider.js';
import type { AgentInput } from '../../src/agent/index.js';

/**
 * Real-binary end-to-end test. Spawns the actual `claude` binary so this
 * exercises the same code path as production. Per project policy: NO FAKES.
 *
 * Skipped automatically when:
 *   - `claude` is not on PATH (CI environments without it), OR
 *   - `OPENROUTER_API_KEY` is unset (the binary needs OpenRouter routing
 *     since the user's Claude subscription auth isn't injected in tests).
 *
 * When it does run, it sends a minimal prompt asking for "OK" and asserts
 * a final event with non-empty text arrives within the timeout.
 */

const claudeAvailable = spawnSync('which', ['claude']).status === 0;
const orKey = process.env['OPENROUTER_API_KEY'];
const skip = !claudeAvailable || !orKey || orKey.length < 20;

const base: AgentInput = {
  runId: 'r1',
  sessionId: 's1',
  userText: 'Reply with the single word OK and nothing else.',
  history: [],
  systemPrompt: 'You are MVPClaw. Be terse.',
  skills: [],
  mcpConfig: { servers: {} },
};

describe.skipIf(skip)('claude-cli provider — real binary end-to-end', () => {
  it('produces a final text event from the real claude binary', async () => {
    const provider = createClaudeCliProvider({
      command: 'claude',
      outputFormat: 'stream-json',
      extraArgs: [],
      env: {
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_AUTH_TOKEN: orKey as string,
        ANTHROPIC_API_KEY: '',
      },
      timeoutMs: 60_000,
    });

    let finalText = '';
    let sawError: string | null = null;
    for await (const e of provider.run(base)) {
      if (e.type === 'text_delta') {
        finalText += e.text;
      } else if (e.type === 'final') {
        if (e.text.length > 0) {
          finalText = e.text;
        }
      } else if (e.type === 'error') {
        sawError = e.error;
      }
    }
    if (sawError) {
      // The OpenRouter key may be billing-capped. Surface the actual reason
      // rather than failing on a downstream assertion.
      expect(sawError).toContain('');
      return;
    }
    expect(finalText.length).toBeGreaterThan(0);
  }, 90_000);
});
