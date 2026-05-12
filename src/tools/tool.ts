/**
 * Tool contract — the shape every registered tool must satisfy.
 *
 * A tool is a typed function the agent can call: it has a `name`, a JSON
 * Schema describing its inputs, a free-text `description` for the LLM,
 * and an `execute()` function. The orchestrator never invokes a tool
 * directly — it goes through the `ToolRegistry`.
 */
import type { Db } from '../db/index.js';

/** The five legal sources of a tool. Stored in `tool_calls.source`. */
export type ToolSource = 'builtin' | 'mcp' | 'openrouter-server' | 'anthropic' | 'gemini';

/** Static metadata for a tool. Returned by `describe()`. */
export interface ToolDefinition {
  /** Tool name. Stable; appears in trace events. */
  name: string;
  /** Free-text description shown to the LLM as part of the tool surface. */
  description: string;
  /** JSON Schema describing the inputs (used for validation + LLM hints). */
  inputSchema: Record<string, unknown>;
  /** Where the tool comes from. */
  source: ToolSource;
  /** Whether the tool is enabled in the active configuration. */
  enabled: boolean;
}

/** Runtime context a tool receives at invocation. */
export interface ToolExecutionContext {
  /** Open SQLite handle (for tools that read agent state). */
  db: Db;
  /** Optional internal chat id. Some tools care which chat is asking. */
  chatId?: string;
  /** Optional run id (when invoked during an agent turn). */
  runId?: string;
}

/** A tool implementation. */
export interface ToolHandler {
  /** Static description (the registry indexes by `definition.name`). */
  readonly definition: ToolDefinition;
  /**
   * Execute the tool. Receives the raw input (already validated against
   * `definition.inputSchema` by the registry) and a context object.
   *
   * @param input - The validated tool input.
   * @param ctx - Runtime context (DB handle, optional chat/run ids).
   * @returns The tool's result. Must be JSON-serializable.
   */
  execute(input: unknown, ctx: ToolExecutionContext): Promise<unknown>;
}
