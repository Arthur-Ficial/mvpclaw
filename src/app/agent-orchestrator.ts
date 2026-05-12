/**
 * Agent orchestrator — runs ONE agent turn.
 *
 * Given a resolved inbound (chat, session, inbound message), this module:
 *   1. Creates an `agent_runs` row in `queued`.
 *   2. Opens a JSONL trace file.
 *   3. Builds the system prompt + history.
 *   4. Marks the run `running`, invokes the configured provider.
 *   5. Drains `AgentEvent`s — accumulates text deltas, captures `final`,
 *      writes each event to the trace.
 *   6. Enqueues the final assistant text in the outbox.
 *   7. Inserts the assistant text into `messages` (direction='outbound') so
 *      it appears in subsequent prompts' history.
 *   8. Marks the run `succeeded` (or `failed` with the error).
 *
 * No tool loop in this commit (P6 extends OpenRouter with one); no skill
 * forced-invocation logic here yet (P15's composer + P7's loader add it).
 */
import { recentMessages } from '../db/repos/messages.repo.js';
import { enqueueOutbox } from '../db/repos/outbox.repo.js';
import {
  createRun,
  markRunFailed,
  markRunRunning,
  markRunSucceeded,
} from '../db/repos/runs.repo.js';
import { insertMessage } from '../db/repos/messages.repo.js';
import type { AppContext } from './app-context.js';
import { buildPromptV1 } from './prompt-builder.js';
import type { ResolvedInbound } from './inbound-router.js';
import { openTrace } from './run-tracer.js';

/** Result of `runAgentTurn()`. */
export interface AgentTurnResult {
  runId: string;
  status: 'succeeded' | 'failed';
  replyText: string;
  outboxId: string | null;
  tracePath: string;
  error?: string;
}

/**
 * Run the agent for a single resolved inbound message.
 *
 * @param ctx - The application context (config, db, providers, channels).
 * @param resolved - The router's output: chat + session + inbound message.
 * @returns An `AgentTurnResult` describing the outcome.
 */
export async function runAgentTurn(
  ctx: AppContext,
  resolved: ResolvedInbound,
): Promise<AgentTurnResult> {
  const providerName = ctx.config.agent.provider;
  const provider = ctx.providers[providerName];
  if (!provider) {
    throw new Error(`orchestrator: provider "${providerName}" is not registered`);
  }

  // 1. Create the agent_runs row in 'queued'.
  const run = createRun(ctx.db, {
    session_id: resolved.session.id,
    input_message_id: resolved.message.id,
    provider: providerName,
    trace_path: '', // filled below
  });

  // 2. Open trace + record the trace path on the run row.
  const tracer = openTrace(ctx.tracesDir, run.id, ctx.config.logging.redact);
  ctx.db.prepare('UPDATE agent_runs SET trace_path = ? WHERE id = ?').run(tracer.path, run.id);
  tracer.write({
    type: 'inbound_message_received',
    chat_id: resolved.chat.id,
    session_id: resolved.session.id,
    message_id: resolved.message.id,
    text_len: resolved.message.text.length,
  });

  // 3. Load history (excluding the just-inserted inbound).
  const allHistory = recentMessages(
    ctx.db,
    resolved.session.id,
    ctx.config.agent.maxHistoryMessages,
  );
  const history = allHistory
    .filter((m) => m.id !== resolved.message.id)
    .map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text,
    }));

  const prompt = buildPromptV1({
    systemPromptFile: ctx.config.agent.systemPromptFile,
    skills: [], // P7 populates this from disk; for P4 we ship with [].
    history,
    userText: resolved.message.text,
  });
  tracer.write({
    type: 'prompt_built',
    system_prompt_len: prompt.systemPrompt.length,
    history_count: history.length,
  });

  // 4. Mark running + invoke provider.
  markRunRunning(ctx.db, run.id);
  tracer.write({ type: 'provider_started', provider: providerName });

  let finalText = '';
  let providerError: string | null = null;
  try {
    for await (const event of provider.run({
      runId: run.id,
      sessionId: resolved.session.id,
      userText: prompt.userText,
      history: prompt.history,
      systemPrompt: prompt.systemPrompt,
      skills: [],
      mcpConfig: { servers: {} },
    })) {
      tracer.write({ type: 'provider_event', event });
      if (event.type === 'text_delta') {
        finalText += event.text;
      } else if (event.type === 'final') {
        finalText = event.text;
      } else if (event.type === 'error') {
        providerError = event.error;
        break;
      }
    }
  } catch (err) {
    providerError = err instanceof Error ? err.message : String(err);
  }

  // 5. Outcome — failed or success.
  if (providerError !== null || finalText.length === 0) {
    const error = providerError ?? 'provider yielded no text';
    tracer.write({ type: 'run_failed', error });
    markRunFailed(ctx.db, run.id, error);
    return {
      runId: run.id,
      status: 'failed',
      replyText: '',
      outboxId: null,
      tracePath: tracer.path,
      error,
    };
  }

  // 6. Enqueue outbox.
  const outbox = enqueueOutbox(ctx.db, {
    chat_id: resolved.chat.id,
    run_id: run.id,
    provider: resolved.chat.provider,
    provider_chat_id: resolved.chat.provider_chat_id,
    provider_thread_id: resolved.chat.thread_id,
    kind: 'text',
    text: finalText,
  });
  tracer.write({ type: 'outbox_created', outbox_id: outbox.id });

  // 7. Insert assistant message into history.
  insertMessage(ctx.db, {
    session_id: resolved.session.id,
    direction: 'outbound',
    provider: resolved.chat.provider,
    text: finalText,
  });

  // 8. Mark run succeeded.
  markRunSucceeded(ctx.db, run.id);
  tracer.write({ type: 'provider_finished', text_len: finalText.length });

  return {
    runId: run.id,
    status: 'succeeded',
    replyText: finalText,
    outboxId: outbox.id,
    tracePath: tracer.path,
  };
}
