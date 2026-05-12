/**
 * Agent area — provider adapters and their shared contract.
 *
 * The orchestrator depends on `AgentProviderAdapter` and `AgentEvent`,
 * never on a specific provider implementation. Providers live here:
 *
 *   - `openrouter.provider.ts` (MVP, this area) — non-streaming via
 *     `/chat/completions`. P6 will extend with streaming + tool loop.
 *   - `claude-cli.provider.ts` (P5, future) — spawns `claude --bare -p …`
 *     and parses stream-json events.
 *
 * Providers are pure I/O: they call the SDK / spawn the process and yield
 * `AgentEvent`s. They do NOT touch SQLite, the outbox, or the tool
 * registry — the orchestrator orchestrates.
 */
export type {
  AgentProvider,
  AgentProviderAdapter,
  AgentInput,
  AgentEvent,
  ChatMessage,
  McpConfigSnapshot,
} from './agent-provider.js';
export type { LoadedSkill } from './loaded-skill.js';
export { OpenRouterClient } from './openrouter.client.js';
export type {
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  OpenRouterClientOptions,
  OpenRouterMessage,
} from './openrouter.client.js';
export { createOpenRouterProvider } from './openrouter.provider.js';
export type { OpenRouterProviderOptions } from './openrouter.provider.js';
export { createClaudeCliProvider, parseClaudeStreamLine } from './claude-cli.provider.js';
export type { ClaudeCliProviderOptions } from './claude-cli.provider.js';
