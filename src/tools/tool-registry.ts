/**
 * `ToolRegistry` — the single in-memory index of all registered tools.
 *
 * There is exactly ONE registry per `AppContext`. Tools register at boot
 * (built-ins go in unconditionally; MCP tools when their server is up;
 * Gemini/Anthropic when their keys are present). The orchestrator and
 * the `mvpclaw tool` CLI both read from this same registry.
 */
import type { ToolDefinition, ToolExecutionContext, ToolHandler, ToolSource } from './tool.js';

/** The registry contract. */
export interface ToolRegistry {
  /** Register a tool handler. Throws on name collision. */
  register(handler: ToolHandler): void;
  /** Return every registered handler (regardless of enabled state). */
  list(): readonly ToolHandler[];
  /** Look up a handler by name, or `undefined` if not registered. */
  get(name: string): ToolHandler | undefined;
  /** Convenience: just the static `ToolDefinition`s, suitable for prompts. */
  describe(): readonly ToolDefinition[];
  /**
   * Invoke a tool by name. The registry does NOT validate the input
   * against the schema yet (P6's tool loop will add that); for P5 / C7
   * we trust the caller to send well-formed input.
   *
   * @param name - The tool name.
   * @param input - The input payload.
   * @param ctx - Runtime context.
   * @returns The tool's result.
   * @throws If `name` is not registered or the tool is disabled.
   */
  call(name: string, input: unknown, ctx: ToolExecutionContext): Promise<unknown>;
}

/**
 * Build an empty registry. Built-ins are registered via
 * `registerBuiltinTools(registry)` from `./builtins.ts`.
 *
 * @returns A fresh, empty `ToolRegistry`.
 */
export function createToolRegistry(): ToolRegistry {
  const byName = new Map<string, ToolHandler>();

  return {
    register(handler): void {
      const name = handler.definition.name;
      if (byName.has(name)) {
        throw new Error(`ToolRegistry: tool "${name}" is already registered`);
      }
      byName.set(name, handler);
    },
    list(): readonly ToolHandler[] {
      return Array.from(byName.values());
    },
    get(name): ToolHandler | undefined {
      return byName.get(name);
    },
    describe(): readonly ToolDefinition[] {
      return Array.from(byName.values()).map((h) => h.definition);
    },
    async call(name, input, ctx): Promise<unknown> {
      const handler = byName.get(name);
      if (!handler) {
        throw new Error(`ToolRegistry: no such tool "${name}"`);
      }
      if (!handler.definition.enabled) {
        throw new Error(
          `ToolRegistry: tool "${name}" is registered but disabled in this configuration`,
        );
      }
      return handler.execute(input, ctx);
    },
  };
}

/**
 * Filter a list of tools to a single source.
 *
 * @param tools - The handlers to filter.
 * @param source - The source to keep.
 * @returns Tools whose `definition.source === source`.
 */
export function filterBySource(
  tools: readonly ToolHandler[],
  source: ToolSource,
): readonly ToolHandler[] {
  return tools.filter((t) => t.definition.source === source);
}
