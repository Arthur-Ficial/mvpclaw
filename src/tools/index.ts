/**
 * Tools area — the single `ToolRegistry` + every tool the agent can call.
 *
 * The registry is the boundary between the orchestrator (which doesn't
 * know what tools exist) and the implementations (built-in, MCP-sourced,
 * OpenRouter server tools, Gemini, Anthropic). Tools register here at
 * boot; the prompt builder lists them; the agent calls them by name.
 */
export type { ToolDefinition, ToolExecutionContext, ToolHandler, ToolSource } from './tool.js';
export { createToolRegistry, filterBySource } from './tool-registry.js';
export type { ToolRegistry } from './tool-registry.js';
export { registerBuiltinTools } from './builtins.js';
export type { BuiltinToolDeps } from './builtins.js';
export { registerExternalTools } from './external-tools.js';
export { createAnthropicWebSearchTool } from './anthropic-web-search.tool.js';
export { createGeminiResearchTool } from './gemini-research.tool.js';
export { registerSchedulerTools } from './scheduler-tools.js';
export { registerPowerTools } from './power-tools.js';
