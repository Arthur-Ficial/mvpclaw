/**
 * `gemini_research` — Gemini-as-research tool, wrapped as a local
 * MVPClaw `ToolHandler`.
 *
 * **Disabled by default.** Becomes available only when:
 *   - `GEMINI_API_KEY` env var is set, AND
 *   - `config.gemini.enabled` is `true`
 *
 * Optional grounding tools (`google_search`, `url_context`) are enabled
 * per `config.gemini.tools` flags.
 *
 * Per project policy: real Gemini SDK invocation. No fakes.
 */
import { GoogleGenAI } from '@google/genai';
import type { GeminiConfig } from '../config/index.js';
import type { ToolHandler } from './tool.js';

/** Build the Gemini research tool handler. */
export function createGeminiResearchTool(
  config: GeminiConfig,
  env: NodeJS.ProcessEnv = process.env,
): ToolHandler {
  const apiKey = env[config.apiKeyEnv];
  const enabled = config.enabled === true && typeof apiKey === 'string' && apiKey.length >= 20;

  return {
    definition: {
      name: 'gemini_research',
      description:
        'Ask Gemini a research question. Optionally uses Google Search + URL context for grounding.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The research question.' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      source: 'gemini',
      enabled,
    },
    async execute(input): Promise<unknown> {
      if (!enabled) {
        throw new Error('gemini_research is disabled — set GEMINI_API_KEY and gemini.enabled=true');
      }
      const params = input as { prompt: string };
      const client = new GoogleGenAI({ apiKey: apiKey as string });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools: any[] = [];
      if (config.tools.googleSearch) {
        tools.push({ googleSearch: {} });
      }
      if (config.tools.urlContext) {
        tools.push({ urlContext: {} });
      }
      const response = await client.models.generateContent({
        model: config.model,
        contents: params.prompt,
        ...(tools.length > 0 ? { config: { tools } } : {}),
      });
      return { text: response.text, candidates: response.candidates };
    },
  };
}
