/**
 * Claude CLI provider — spawns the real `claude` binary in `--bare -p`
 * mode and parses its `--output-format stream-json` stream.
 *
 * The binary is reached via stdio. Env injection lets us point it at
 * OpenRouter (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) so the user's
 * Claude subscription is not consumed for routine traffic. Per project
 * policy: NO FAKES. Tests spawn the real binary; the parser is exercised
 * with a deterministic fixture stream over stdin.
 *
 * Stream-json shape (one JSON object per line):
 *   - `{"type":"text","text":"…"}`             → `text_delta`
 *   - `{"type":"tool_use",…}`                  → `tool_call`
 *   - `{"type":"tool_result",…}`               → `tool_result`
 *   - `{"type":"message_stop"}` or
 *     `{"type":"result", "text":"…"}`          → `final`
 *   - any non-stream-json text on stderr        → buffered into `error`
 *     (only emitted if exit code != 0)
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  AgentEvent,
  AgentInput,
  AgentProviderAdapter,
  ChatMessage,
} from './agent-provider.js';

/** Settings the Claude CLI provider needs at construction. */
export interface ClaudeCliProviderOptions {
  /** Path or command name of the `claude` binary (default: `"claude"`). */
  command: string;
  /** Output format flag value. Only `stream-json` is parsed here. */
  outputFormat: 'stream-json';
  /** Args appended after `--bare -p` (e.g. `--allowedTools …`). */
  extraArgs: readonly string[];
  /** Env vars to set when spawning (merged onto `process.env`). */
  env: Record<string, string>;
  /** Optional spawn override for tests. */
  spawnImpl?: typeof spawn;
  /** Timeout in ms before the subprocess is SIGKILLed. */
  timeoutMs: number;
}

/**
 * Construct a Claude CLI provider adapter.
 *
 * @param opts - Command path, output format, args, env, timeout.
 * @returns An `AgentProviderAdapter` with `name: "claude-cli"`.
 */
export function createClaudeCliProvider(opts: ClaudeCliProviderOptions): AgentProviderAdapter {
  return {
    name: 'claude-cli' as const,
    run(input: AgentInput): AsyncIterable<AgentEvent> {
      return runClaudeCli(opts, input);
    },
  };
}

/**
 * Build the prompt body the CLI receives on stdin. The composer's system
 * prompt becomes a `<system>` preamble; history is rendered as `User:` /
 * `Assistant:` turns; the new user turn is appended last. This is the
 * format the bare `claude -p` accepts.
 */
function renderPrompt(input: AgentInput): string {
  const parts: string[] = [];
  if (input.systemPrompt.trim().length > 0) {
    parts.push(`<system>\n${input.systemPrompt}\n</system>`);
  }
  for (const m of input.history) {
    parts.push(`${roleLabel(m)}: ${m.content}`);
  }
  parts.push(`User: ${input.userText}`);
  return parts.join('\n\n');
}

function roleLabel(m: ChatMessage): string {
  if (m.role === 'assistant') {
    return 'Assistant';
  }
  if (m.role === 'system') {
    return 'System';
  }
  return 'User';
}

/**
 * Parse one line of `--output-format stream-json` into zero or one
 * `AgentEvent`. Lines that fail to parse, or events we don't recognise,
 * are ignored (the upstream binary emits a small set of types and adds
 * new ones across versions — we tolerate forward-compat).
 *
 * @param line - One trimmed line from stdout.
 * @returns The translated `AgentEvent`, or `null` to skip.
 */
export function parseClaudeStreamLine(line: string): AgentEvent | null {
  if (line.length === 0) {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = typeof parsed['type'] === 'string' ? (parsed['type'] as string) : '';
  switch (type) {
    case 'text':
    case 'content_block_delta':
    case 'text_delta': {
      const text =
        (typeof parsed['text'] === 'string' && (parsed['text'] as string)) ||
        extractDeltaText(parsed) ||
        '';
      if (text.length === 0) {
        return null;
      }
      return { type: 'text_delta', text };
    }
    case 'tool_use': {
      const name = typeof parsed['name'] === 'string' ? (parsed['name'] as string) : '';
      const callId =
        typeof parsed['id'] === 'string'
          ? (parsed['id'] as string)
          : typeof parsed['tool_use_id'] === 'string'
            ? (parsed['tool_use_id'] as string)
            : '';
      const inputVal = parsed['input'] ?? {};
      return { type: 'tool_call', name, callId, input: inputVal };
    }
    case 'tool_result': {
      const callId =
        typeof parsed['tool_use_id'] === 'string'
          ? (parsed['tool_use_id'] as string)
          : typeof parsed['id'] === 'string'
            ? (parsed['id'] as string)
            : '';
      return { type: 'tool_result', callId, result: parsed['result'] ?? parsed['content'] ?? null };
    }
    case 'result':
    case 'message_stop':
    case 'final': {
      const text = typeof parsed['text'] === 'string' ? (parsed['text'] as string) : '';
      return { type: 'final', text, usage: parsed['usage'] };
    }
    case 'error': {
      const message =
        typeof parsed['error'] === 'string'
          ? (parsed['error'] as string)
          : typeof parsed['message'] === 'string'
            ? (parsed['message'] as string)
            : 'unknown error';
      return { type: 'error', error: message };
    }
    default:
      return null;
  }
}

function extractDeltaText(parsed: Record<string, unknown>): string {
  const delta = parsed['delta'];
  if (typeof delta === 'object' && delta !== null && 'text' in delta) {
    const t = (delta as Record<string, unknown>)['text'];
    return typeof t === 'string' ? t : '';
  }
  return '';
}

async function* runClaudeCli(
  opts: ClaudeCliProviderOptions,
  input: AgentInput,
): AsyncIterable<AgentEvent> {
  const spawnFn = opts.spawnImpl ?? spawn;
  const args = ['--bare', '-p', '--output-format', opts.outputFormat, ...opts.extraArgs];
  const child = spawnFn(opts.command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
  });

  let errBuf = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    errBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  });

  child.stdin?.write(renderPrompt(input));
  child.stdin?.end();

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, opts.timeoutMs);

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  let sawFinal = false;
  let accumulated = '';
  try {
    for await (const rawLine of rl) {
      const event = parseClaudeStreamLine(rawLine.trim());
      if (!event) {
        continue;
      }
      if (event.type === 'text_delta') {
        accumulated += event.text;
      }
      if (event.type === 'final') {
        sawFinal = true;
        if (event.text.length === 0 && accumulated.length > 0) {
          yield { type: 'final', text: accumulated, usage: event.usage };
        } else {
          yield event;
        }
        continue;
      }
      yield event;
    }
  } finally {
    clearTimeout(timer);
  }

  const exitCode: number | null = await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.on('exit', (code) => resolve(code));
  });

  if (!sawFinal) {
    if (accumulated.length > 0) {
      yield { type: 'final', text: accumulated };
    } else if (exitCode !== 0) {
      yield {
        type: 'error',
        error: errBuf.trim() || `claude exited with code ${String(exitCode)}`,
      };
    }
  }
}
