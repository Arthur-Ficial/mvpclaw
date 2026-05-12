/**
 * OpenRouter direct provider — implements `AgentProviderAdapter`.
 *
 * MVP scope (P4 commit): non-streaming. Builds the messages array from
 * `AgentInput`, calls `/chat/completions`, yields a single `final` event
 * with the assistant text.
 *
 * P6 extends this with: streaming via `stream: true`, server-tools
 * passthrough (`openrouter:web_search` etc.), and the function-tool loop
 * (max rounds, `tool_call` / `tool_result` events).
 */
import type { AgentEvent, AgentInput, AgentProviderAdapter } from './agent-provider.js';
import { OpenRouterClient, type OpenRouterMessage } from './openrouter.client.js';

/** Settings the OpenRouter provider needs at construction. */
export interface OpenRouterProviderOptions {
  /** OpenRouter API key (value, not env name). */
  apiKey: string;
  /** Base URL, e.g. `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  /** Model id, e.g. `meta-llama/llama-3.2-3b-instruct:free`. */
  model: string;
  /** Optional analytics headers. */
  referer?: string;
  /** Optional analytics headers. */
  title?: string;
  /** Optional `fetch` override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Construct an OpenRouter direct provider.
 *
 * @param opts - API key, base URL, model id, optional headers + fetch.
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
      return runOpenRouter(client, opts.model, input);
    },
  };
}

/** Build the OpenRouter `messages` array from an `AgentInput`. */
function buildMessages(input: AgentInput): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = [];
  if (input.systemPrompt.trim().length > 0) {
    out.push({ role: 'system', content: input.systemPrompt });
  }
  for (const m of input.history) {
    out.push({ role: m.role === 'system' ? 'system' : m.role, content: m.content });
  }
  out.push({ role: 'user', content: input.userText });
  return out;
}

/**
 * The actual generator. Lives outside `createOpenRouterProvider` so it can
 * be referenced from tests directly without going through the adapter.
 */
async function* runOpenRouter(
  client: OpenRouterClient,
  model: string,
  input: AgentInput,
): AsyncIterable<AgentEvent> {
  try {
    const res = await client.chatCompletions({
      model,
      messages: buildMessages(input),
    });
    const text = res.choices[0]?.message?.content ?? '';
    yield { type: 'final', text, usage: res.usage };
  } catch (err) {
    yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
