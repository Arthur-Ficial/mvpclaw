/**
 * The `AgentProviderAdapter` interface — the boundary between the
 * orchestrator and an AI provider (Claude CLI, OpenRouter direct, future).
 *
 * Per the spec, the orchestrator depends on this small interface, not on
 * any provider SDK. The shape mirrors `ChannelAdapter` for symmetry: a
 * `name`, a `run()` that returns an `AsyncIterable<AgentEvent>`, and no
 * implementation-specific surface area.
 *
 * Provider implementations live in this area (`src/agent/`):
 *   - `claude-cli.provider.ts`   (ticket P5)  — real `claude` binary
 *   - `openrouter.provider.ts`   (P4 minimal; P6 extends)
 */
import type { LoadedSkill } from './loaded-skill.js';

/** Provider name used by the agent layer. */
export type AgentProvider = 'claude-cli' | 'openrouter';

/** A chat-history message as the provider sees it. */
export interface ChatMessage {
  /** Speaker role. `system` = preamble; `user` = inbound; `assistant` = prior reply. */
  role: 'system' | 'user' | 'assistant';
  /** Plain-text content. */
  content: string;
}

/** Generated MCP config snapshot for the run (paths to MCP server commands). */
export interface McpConfigSnapshot {
  servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

/** Everything a provider needs to run a single agent turn. */
export interface AgentInput {
  /** ULID for this run (matches `agent_runs.id`). */
  runId: string;
  /** Session ULID (matches `sessions.id`). */
  sessionId: string;
  /** Inbound user message (already validated and stored). */
  userText: string;
  /** Chronological chat history up to (but not including) the inbound. */
  history: readonly ChatMessage[];
  /** Composed system prompt (preamble + memory + skills metadata + tool descriptions). */
  systemPrompt: string;
  /** Loaded skills available this turn. Full body of any forced skill is in `systemPrompt`. */
  skills: readonly LoadedSkill[];
  /** Generated MCP config for Claude CLI (`--mcp-config`); ignored by OpenRouter direct. */
  mcpConfig: McpConfigSnapshot;
  /** Internal chat id (ULID). Forwarded to tool context. */
  chatId?: string;
  /** External chat id (e.g. Telegram chat_id). Forwarded to tool context. */
  providerChatId?: string;
  /** Channel name (`'telegram'`, `'cli-inject'`, …). Forwarded to tool context. */
  channel?: string;
}

/**
 * Discriminated union of events a provider yields during a run.
 *
 * Streaming providers (Claude CLI stream-json, OpenRouter with `stream: true`)
 * emit many `text_delta` events followed by a single `final`. Non-streaming
 * providers emit zero `text_delta`s and a single `final`. Either is valid.
 *
 * `error` is terminal — the orchestrator stops draining after it.
 */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; name: string; input: unknown; callId: string }
  | { type: 'tool_result'; callId: string; result: unknown }
  | { type: 'final'; text: string; usage?: unknown }
  | { type: 'error'; error: string };

/**
 * The contract every provider satisfies.
 *
 * @remarks
 * Providers are pure I/O — they own the SDK call, the streaming parser,
 * and any retries. They do NOT touch SQLite, the outbox, or the tool
 * registry directly. The orchestrator collects events and applies them.
 */
export interface AgentProviderAdapter {
  /** Provider name. Stable; matches `agent_runs.provider`. */
  readonly name: AgentProvider;

  /**
   * Run a single agent turn and yield events.
   *
   * @param input - Prompt + history + skills + MCP config for this turn.
   * @returns An `AsyncIterable<AgentEvent>` the orchestrator iterates.
   */
  run(input: AgentInput): AsyncIterable<AgentEvent>;
}
