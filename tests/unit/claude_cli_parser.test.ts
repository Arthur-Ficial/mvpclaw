import { describe, it, expect } from 'vitest';
import { parseClaudeStreamLine } from '../../src/agent/claude-cli.provider.js';

/**
 * `parseClaudeStreamLine` — small, pure parser for one line of
 * `claude --output-format stream-json`. Covers the shapes the binary emits
 * across versions; unknown types and malformed JSON skip cleanly to `null`.
 */
describe('parseClaudeStreamLine', () => {
  it('parses a plain text event', () => {
    const evt = parseClaudeStreamLine(JSON.stringify({ type: 'text', text: 'hello' }));
    expect(evt).toEqual({ type: 'text_delta', text: 'hello' });
  });

  it('parses content_block_delta with nested text', () => {
    const evt = parseClaudeStreamLine(
      JSON.stringify({ type: 'content_block_delta', delta: { text: 'world' } }),
    );
    expect(evt).toEqual({ type: 'text_delta', text: 'world' });
  });

  it('parses a tool_use event', () => {
    const evt = parseClaudeStreamLine(
      JSON.stringify({ type: 'tool_use', id: 'tu_1', name: 'mvpclaw_datetime', input: {} }),
    );
    expect(evt).toEqual({ type: 'tool_call', name: 'mvpclaw_datetime', callId: 'tu_1', input: {} });
  });

  it('parses a tool_result event', () => {
    const evt = parseClaudeStreamLine(
      JSON.stringify({ type: 'tool_result', tool_use_id: 'tu_1', result: { ok: 1 } }),
    );
    expect(evt).toEqual({ type: 'tool_result', callId: 'tu_1', result: { ok: 1 } });
  });

  it('parses a final result with text', () => {
    const evt = parseClaudeStreamLine(
      JSON.stringify({ type: 'result', text: 'done', usage: { tokens: 10 } }),
    );
    expect(evt).toEqual({ type: 'final', text: 'done', usage: { tokens: 10 } });
  });

  it('parses message_stop without text', () => {
    const evt = parseClaudeStreamLine(JSON.stringify({ type: 'message_stop' }));
    expect(evt).toEqual({ type: 'final', text: '', usage: undefined });
  });

  it('parses an error event', () => {
    const evt = parseClaudeStreamLine(JSON.stringify({ type: 'error', error: 'rate limited' }));
    expect(evt).toEqual({ type: 'error', error: 'rate limited' });
  });

  it('returns null for unknown types', () => {
    const evt = parseClaudeStreamLine(JSON.stringify({ type: 'something_new', foo: 'bar' }));
    expect(evt).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseClaudeStreamLine('not json at all')).toBeNull();
    expect(parseClaudeStreamLine('')).toBeNull();
  });

  it('skips empty text deltas', () => {
    const evt = parseClaudeStreamLine(JSON.stringify({ type: 'text', text: '' }));
    expect(evt).toBeNull();
  });
});
