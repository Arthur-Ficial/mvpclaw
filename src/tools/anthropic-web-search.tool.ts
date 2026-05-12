/**
 * `anthropic_web_search` — Anthropic's web search tool, wrapped as a
 * local MVPClaw `ToolHandler`.
 *
 * **Disabled by default.** Becomes available only when:
 *   - `ANTHROPIC_API_KEY` env var is set, AND
 *   - `config.anthropic.webSearch.enabled` is `true`
 *
 * `respectsBudget` is bounded by `config.anthropic.webSearch.maxUses`
 * (default 5) per call.
 *
 * Per project policy: real Anthropic SDK invocation. No fakes.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicConfig } from '../config/index.js';
import type { ToolHandler } from './tool.js';

/** Build the Anthropic web-search tool handler. */
export function createAnthropicWebSearchTool(
  config: AnthropicConfig,
  env: NodeJS.ProcessEnv = process.env,
): ToolHandler {
  const apiKey = env[config.apiKeyEnv];
  const enabled =
    config.enabled === true &&
    config.webSearch.enabled === true &&
    typeof apiKey === 'string' &&
    apiKey.length >= 20;

  return {
    definition: {
      name: 'anthropic_web_search',
      description:
        "Search the web via Anthropic's web search tool. Returns search results with URLs and snippets.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      source: 'anthropic',
      enabled,
    },
    async execute(input): Promise<unknown> {
      if (!enabled) {
        throw new Error(
          'anthropic_web_search is disabled — set ANTHROPIC_API_KEY and anthropic.webSearch.enabled=true',
        );
      }
      const params = input as { query: string };
      const client = new Anthropic({ apiKey: apiKey as string });
      // The Anthropic web-search tool is exposed by the Messages API via
      // `tools: [{ type: "web_search_20250305", ... }]`. Per the spec we
      // pass through `max_uses` from config to cap usage.
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: params.query }],
        tools: [
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: 'web_search_20250305' as any,
            name: 'web_search',
            max_uses: config.webSearch.maxUses,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
      });
      return response;
    },
  };
}
