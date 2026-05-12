/**
 * External-tool registration — Anthropic web search + Gemini research.
 *
 * Both tools register UNCONDITIONALLY but their `definition.enabled` is
 * false when their API key env var is missing or their config block has
 * `enabled: false`. The CLI surfaces this via `mvpclaw tool list` so an
 * AI agent can see what's available and what would need a key.
 *
 * This file is separate from `./builtins.ts` because external tools have
 * real SDK dependencies (`@anthropic-ai/sdk`, `@google/genai`) that we
 * don't want to load on every boot if the user opted out via config.
 */
import type { MvpClawConfigType } from '../config/index.js';
import { createAnthropicWebSearchTool } from './anthropic-web-search.tool.js';
import { createGeminiResearchTool } from './gemini-research.tool.js';
import type { ToolRegistry } from './tool-registry.js';

/**
 * Register the external (Anthropic, Gemini) tools on `registry`.
 *
 * @param registry - The registry instance.
 * @param config - Resolved MVPClaw config (frozen).
 * @param env - Process env (defaults to `process.env`).
 */
export function registerExternalTools(
  registry: ToolRegistry,
  config: MvpClawConfigType,
  env: NodeJS.ProcessEnv = process.env,
): void {
  registry.register(createAnthropicWebSearchTool(config.anthropic, env));
  registry.register(createGeminiResearchTool(config.gemini, env));
}
