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
 * using the free model (`meta-llama/llama-3.2-3b-instruct:free`) so any
 * change here is validated against the real API surface, not a mock.
 */

/** A single message in the OpenRouter chat-completions payload. */
export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Chat-completions request body (subset of the OpenAI-compatible schema). */
export interface ChatCompletionsRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
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
}
