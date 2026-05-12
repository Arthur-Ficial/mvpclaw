/**
 * OpenRouter direct provider — implements `AgentProviderAdapter`.
 *
 * Capabilities (P6):
 *   - Streaming SSE via `stream: true` — yields per-token `text_delta`
 *     events and a single `final`.
 *   - Function-tool loop — when the model returns `tool_calls`, the
 *     provider dispatches each through the project's `ToolRegistry`,
 *     appends the result as a `role: 'tool'` message, and re-invokes the
 *     model. Stops at `maxToolRounds` or when no tool_calls remain.
 *   - Tool definitions are filtered to enabled function tools; server-tools
 *     (e.g. `openrouter:web_search`) are appended verbatim from config.
 *
 * The provider stays pure I/O: no SQLite, no outbox, no skill files. The
 * orchestrator threads `tools` through `AgentInput`-adjacent state via
 * an options bag passed at construction.
 */
import type {
  AgentEvent,
  AgentInput,
  AgentProviderAdapter,
  ChatMessage,
} from './agent-provider.js';
import {
  OpenRouterClient,
  type ChatCompletionsChunk,
  type OpenRouterMessage,
  type OpenRouterToolCall,
  type OpenRouterToolDefinition,
} from './openrouter.client.js';
import type { ToolExecutionContext, ToolHandler } from '../tools/tool.js';

/** Hook to pull the current enabled tool handlers + execution context. */
export interface ToolBridge {
  list(): readonly ToolHandler[];
  context(input: AgentInput): ToolExecutionContext;
}

/** Settings the OpenRouter provider needs at construction. */
export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  referer?: string;
  title?: string;
  fetchImpl?: typeof fetch;
  /** Maximum tool-call rounds before forcing a final reply. */
  maxToolRounds?: number;
  /** Tool bridge — when present and enabled, function tools are exposed. */
  tools?: ToolBridge;
  /** Server-tools (e.g. `{type:'web_search'}`) appended to the request. */
  serverTools?: ReadonlyArray<{ type: string; parameters?: Record<string, unknown> | undefined }>;
  /** Force non-streaming. Default `false` → stream. */
  disableStreaming?: boolean;
}

/**
 * Construct an OpenRouter direct provider.
 *
 * @param opts - API key, base URL, model id, optional tool bridge + headers.
 * @returns An `AgentProviderAdapter` with `name: "openrouter"`.
 */
export function createOpenRouterProvider(opts: OpenRouterProviderOptions): AgentProviderAdapter {
  const client = new OpenRouterClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.referer !== undefined ? { referer: opts.referer } : {}),
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });

  return {
    name: 'openrouter' as const,
    run(input: AgentInput): AsyncIterable<AgentEvent> {
      return runOpenRouter(client, opts, input);
    },
  };
}

function buildMessages(input: AgentInput): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = [];
  if (input.systemPrompt.trim().length > 0) {
    out.push({ role: 'system', content: input.systemPrompt });
  }
  for (const m of input.history as readonly ChatMessage[]) {
    out.push({ role: m.role === 'system' ? 'system' : m.role, content: m.content });
  }
  out.push({ role: 'user', content: input.userText });
  return out;
}

function toolDefinitions(tools: ToolBridge | undefined): OpenRouterToolDefinition[] {
  if (!tools) {
    return [];
  }
  return tools
    .list()
    .filter((t) => t.definition.enabled && t.definition.source !== 'openrouter-server')
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.inputSchema,
      },
    }))
    .sort((a, b) =>
      a.function.name < b.function.name ? -1 : a.function.name > b.function.name ? 1 : 0,
    );
}

async function* runOpenRouter(
  client: OpenRouterClient,
  opts: OpenRouterProviderOptions,
  input: AgentInput,
): AsyncIterable<AgentEvent> {
  const messages = buildMessages(input);
  const tools = toolDefinitions(opts.tools);
  const maxRounds = opts.maxToolRounds ?? 8;

  for (let round = 0; round <= maxRounds; round++) {
    try {
      const request = {
        model: opts.model,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      };
      if (opts.disableStreaming === true) {
        const res = await client.chatCompletions(request);
        const choice = res.choices[0];
        if (!choice) {
          yield { type: 'final', text: '' };
          return;
        }
        const toolCalls = choice.message.tool_calls ?? [];
        if (toolCalls.length > 0 && round < maxRounds && opts.tools) {
          messages.push(choice.message);
          for await (const event of dispatchToolCalls(toolCalls, opts.tools, input)) {
            messages.push(event.toolResultMessage);
            yield event.callEvent;
            yield event.resultEvent;
          }
          continue;
        }
        yield { type: 'final', text: choice.message.content ?? '', usage: res.usage };
        return;
      }
      // Streaming path.
      const collected = { text: '', toolCalls: new Map<number, OpenRouterToolCall>() };
      for await (const chunk of client.chatCompletionsStream(request)) {
        applyDelta(chunk, collected);
        const deltaText = chunk.choices[0]?.delta.content;
        if (typeof deltaText === 'string' && deltaText.length > 0) {
          yield { type: 'text_delta', text: deltaText };
        }
      }
      const toolCalls = Array.from(collected.toolCalls.values());
      if (toolCalls.length > 0 && round < maxRounds && opts.tools) {
        messages.push({
          role: 'assistant',
          content: collected.text.length > 0 ? collected.text : null,
          tool_calls: toolCalls,
        });
        for await (const event of dispatchToolCalls(toolCalls, opts.tools, input)) {
          messages.push(event.toolResultMessage);
          yield event.callEvent;
          yield event.resultEvent;
        }
        continue;
      }
      yield { type: 'final', text: collected.text };
      return;
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
      return;
    }
  }
}

interface DispatchedTool {
  callEvent: AgentEvent;
  resultEvent: AgentEvent;
  toolResultMessage: OpenRouterMessage;
}

async function* dispatchToolCalls(
  calls: readonly OpenRouterToolCall[],
  tools: ToolBridge,
  input: AgentInput,
): AsyncIterable<DispatchedTool> {
  for (const call of calls) {
    let parsedInput: unknown;
    try {
      parsedInput = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      parsedInput = call.function.arguments;
    }
    const callEvent: AgentEvent = {
      type: 'tool_call',
      name: call.function.name,
      callId: call.id,
      input: parsedInput,
    };
    let result: unknown;
    try {
      const handler = tools.list().find((t) => t.definition.name === call.function.name);
      if (!handler) {
        throw new Error(`no such tool: ${call.function.name}`);
      }
      if (!handler.definition.enabled) {
        throw new Error(`tool "${call.function.name}" is disabled`);
      }
      result = await handler.execute(parsedInput, tools.context(input));
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
    const resultEvent: AgentEvent = { type: 'tool_result', callId: call.id, result };
    yield {
      callEvent,
      resultEvent,
      toolResultMessage: {
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      },
    };
  }
}

function applyDelta(
  chunk: ChatCompletionsChunk,
  acc: { text: string; toolCalls: Map<number, OpenRouterToolCall> },
): void {
  const choice = chunk.choices[0];
  if (!choice) {
    return;
  }
  const dContent = choice.delta.content;
  if (typeof dContent === 'string') {
    acc.text += dContent;
  }
  const dTools = choice.delta.tool_calls;
  if (Array.isArray(dTools)) {
    for (const t of dTools) {
      const idx = t.index;
      const existing = acc.toolCalls.get(idx) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (typeof t.id === 'string') {
        existing.id = t.id;
      }
      if (t.function) {
        if (typeof t.function.name === 'string') {
          existing.function.name = t.function.name;
        }
        if (typeof t.function.arguments === 'string') {
          existing.function.arguments += t.function.arguments;
        }
      }
      acc.toolCalls.set(idx, existing);
    }
  }
}
