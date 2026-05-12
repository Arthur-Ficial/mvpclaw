/**
 * OpenRouter HTTP client — typed, native fetch, no SDK.
 *
 * MVP scope (this commit, P4):
 *   - `chatCompletions(req)` — POST /chat/completions, non-streaming.
 *
 * Ticket P6 extends this with: streaming, server-tools passthrough, the
 * function-tool loop, and a generic `request<T>()` escape hatch for newer
 * OpenRouter endpoints without changing the architecture.
 *
 * Per the project policy: NO FAKE PROVIDERS. Tests hit real OpenRouter
 * using `openai/gpt-4o-mini` (~$0.0001/call) so any change here is
 * validated against the real API surface, not a mock.
 */

/** A function-tool call returned by the model. */
export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A single message in the OpenRouter chat-completions payload. */
export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Present on assistant messages that call tools. */
  tool_calls?: OpenRouterToolCall[];
  /** Present on `role: 'tool'` messages — references the call id. */
  tool_call_id?: string;
  /** Optional name (`role: 'tool'`). */
  name?: string;
}

/** Tool definition surfaced to OpenRouter. */
export interface OpenRouterToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Chat-completions request body (subset of the OpenAI-compatible schema). */
export interface ChatCompletionsRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Function tools the model may call. */
  tools?: OpenRouterToolDefinition[];
  /** Forced or auto tool choice. */
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Stream Server-Sent Events. */
  stream?: boolean;
}

/** Chat-completions response body (subset). */
export interface ChatCompletionsResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** One streaming SSE chunk (OpenAI-compatible delta shape). */
export interface ChatCompletionsChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Settings the client needs to talk to OpenRouter. */
export interface OpenRouterClientOptions {
  /** Base URL, e.g. `https://openrouter.ai/api/v1`. No trailing slash. */
  baseUrl: string;
  /** OpenRouter API key (the value, not the env name). */
  apiKey: string;
  /** Optional `fetch` override (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
  /** Optional `HTTP-Referer` header for OpenRouter analytics. */
  referer?: string;
  /** Optional `X-Title` header for OpenRouter analytics. */
  title?: string;
}

/**
 * A thin, typed OpenRouter client.
 *
 * The constructor captures the API key once; per-call methods accept the
 * request body. No retries here — the orchestrator decides retry policy.
 */
export class OpenRouterClient {
  /** Configured options (frozen at construction). */
  private readonly opts: Required<Pick<OpenRouterClientOptions, 'baseUrl' | 'apiKey'>> &
    OpenRouterClientOptions;

  /**
   * Build a new client.
   *
   * @param opts - Base URL, API key, optional analytics headers, optional
   *               `fetch` override (used by integration tests if needed).
   */
  constructor(opts: OpenRouterClientOptions) {
    // Spread raw options first; normalised values come AFTER so they win.
    this.opts = {
      ...opts,
      baseUrl: opts.baseUrl.replace(/\/$/, ''),
      apiKey: opts.apiKey,
    };
  }

  /**
   * Call OpenRouter's `/chat/completions` endpoint (non-streaming).
   *
   * Retries on 429 (rate limit) up to `maxRetries` times, honouring the
   * `Retry-After` header when present. Other 4xx / 5xx responses raise
   * immediately with the response body in the error message.
   *
   * @param req - The chat-completions request body.
   * @param maxRetries - Max 429 retries. Default 3.
   * @returns The parsed response.
   * @throws If the HTTP status is not 2xx after retries.
   */
  async chatCompletions(
    req: ChatCompletionsRequest,
    maxRetries = 3,
  ): Promise<ChatCompletionsResponse> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.opts.referer !== undefined) {
      headers['HTTP-Referer'] = this.opts.referer;
    }
    if (this.opts.title !== undefined) {
      headers['X-Title'] = this.opts.title;
    }
    let lastBody = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      });
      if (res.ok) {
        return (await res.json()) as ChatCompletionsResponse;
      }
      lastBody = await res.text().catch(() => '');
      if (res.status !== 429 || attempt === maxRetries) {
        throw new Error(`OpenRouter chatCompletions ${res.status}: ${lastBody || res.statusText}`);
      }
      const retryHeader = res.headers.get('retry-after');
      const retrySeconds = retryHeader !== null ? Number(retryHeader) : NaN;
      const delayMs =
        Number.isFinite(retrySeconds) && retrySeconds > 0
          ? Math.min(retrySeconds * 1000, 30_000)
          : 1000 * Math.pow(2, attempt); // exponential backoff if no header
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
    // Unreachable — the loop either returns or throws.
    throw new Error(`OpenRouter chatCompletions exhausted retries: ${lastBody}`);
  }

  /**
   * Stream `/chat/completions` as Server-Sent Events. Yields one
   * `ChatCompletionsChunk` per parsed `data:` line. The terminal
   * `data: [DONE]` line ends the iterator. No retry — streaming callers
   * see partial output, so reconnects belong upstream.
   *
   * @param req - The chat-completions request body (caller sets `stream:true`).
   * @returns An async iterator over decoded chunks.
   */
  async *chatCompletionsStream(req: ChatCompletionsRequest): AsyncIterable<ChatCompletionsChunk> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (this.opts.referer !== undefined) {
      headers['HTTP-Referer'] = this.opts.referer;
    }
    if (this.opts.title !== undefined) {
      headers['X-Title'] = this.opts.title;
    }
    const body = JSON.stringify({ ...req, stream: true });
    if (process.env['MVPCLAW_DEBUG_HTTP'] === '1') {
      process.stderr.write(`[mvpclaw-debug] POST stream body=${body}\n`);
    }
    const res = await fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      const respBody = await res.text().catch(() => '');
      throw new Error(`OpenRouter stream ${res.status}: ${respBody || res.statusText}`);
    }
    if (!res.body) {
      throw new Error('OpenRouter stream: response body is null');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trimEnd();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line.startsWith('data:')) {
          continue;
        }
        const payload = line.slice('data:'.length).trim();
        if (payload === '[DONE]') {
          return;
        }
        try {
          yield JSON.parse(payload) as ChatCompletionsChunk;
        } catch {
          // Tolerate keep-alives and partial frames; SSE frames may split.
          continue;
        }
      }
    }
  }
}
