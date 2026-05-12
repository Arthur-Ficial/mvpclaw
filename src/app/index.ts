/**
 * App area — the orchestrator that ties everything together.
 *
 * Three responsibilities (one per file):
 *   1. **Routing** (`inbound-router.ts`) — channels deliver an
 *      `InboundMessage`; the router resolves chat + session + message
 *      rows, dedups on `provider_update_id`, and dispatches built-in
 *      slash commands directly to the outbox without calling the model.
 *   2. **Orchestration** (`agent-orchestrator.ts`) — runs one agent
 *      turn: creates `agent_runs`, opens the JSONL trace, builds the
 *      prompt, invokes the configured provider, drains `AgentEvent`s,
 *      enqueues the reply, and marks the run succeeded or failed.
 *   3. **Delivery** (`outbox-worker.ts`) — drains pending outbox rows
 *      via the appropriate `ChannelAdapter.send()`. Idempotent.
 *
 * The `AppContext` (`app-context.ts`) is the DI container threaded
 * through every function — config, logger, DB handle, channels, and
 * providers all live there.
 */
export type { AppContext } from './app-context.js';
export { routeInbound } from './inbound-router.js';
export type { ResolvedInbound } from './inbound-router.js';
export { runAgentTurn } from './agent-orchestrator.js';
export type { AgentTurnResult } from './agent-orchestrator.js';
export { drainOutbox } from './outbox-worker.js';
export type { DrainResult } from './outbox-worker.js';
export { buildPromptV1 } from './prompt-builder.js';
export type { PromptBuilderInput, PromptBuilderOutput } from './prompt-builder.js';
export { openTrace } from './run-tracer.js';
export type { TraceEvent, TraceEventType, RunTracer } from './run-tracer.js';
