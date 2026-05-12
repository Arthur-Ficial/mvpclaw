/**
 * Per-run JSONL tracer.
 *
 * Every agent run writes its event stream to `data/traces/<runId>.jsonl`.
 * The format is line-delimited JSON — `mvpclaw trace tail` (C10) streams
 * the file in real time; `mvpclaw replay` (C6) re-runs from it.
 *
 * Events:
 *   - `inbound_message_received`
 *   - `prompt_built`
 *   - `provider_started`
 *   - `provider_event`  (one per agent event)
 *   - `tool_call_started` / `tool_call_finished` (extracted from events)
 *   - `outbox_created`
 *   - `provider_finished`
 *   - `run_failed`
 *
 * Every line goes through the project's redactor — the tracer never writes
 * secrets even if a provider tries to echo one back.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactString } from '../logging/index.js';

/** Trace event types — string union for compile-time exhaustiveness. */
export type TraceEventType =
  | 'inbound_message_received'
  | 'prompt_built'
  | 'provider_started'
  | 'provider_event'
  | 'tool_call_started'
  | 'tool_call_finished'
  | 'outbox_created'
  | 'provider_finished'
  | 'run_failed';

/** A single line in the JSONL trace file. */
export interface TraceEvent {
  type: TraceEventType;
  at: string;
  [k: string]: unknown;
}

/** Result of `openTrace()` — the writer + the resolved path. */
export interface RunTracer {
  /** Absolute path to the JSONL file. */
  readonly path: string;
  /** Append one event. Redacts secrets before write. */
  write(event: TraceEvent | Omit<TraceEvent, 'at'>): void;
}

/**
 * Resolve `data/traces/<runId>.jsonl` under `tracesDir` and return a
 * `RunTracer` ready to write to it. Creates parent directories.
 *
 * @param tracesDir - The traces directory (typically `data/traces`).
 * @param runId - The agent run's id (ULID).
 * @param redactEnvNames - Env var names whose values should be redacted
 *                         from any free-text in the trace lines.
 * @returns A `RunTracer` whose `write()` appends one line per call.
 */
export function openTrace(
  tracesDir: string,
  runId: string,
  redactEnvNames: readonly string[],
): RunTracer {
  const path = join(tracesDir, `${runId}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  return {
    path,
    write(event): void {
      const stamped: TraceEvent =
        'at' in event
          ? (event as TraceEvent)
          : { ...(event as TraceEvent), at: new Date().toISOString() };
      const json = JSON.stringify(stamped);
      const safe = redactString(json, redactEnvNames);
      appendFileSync(path, safe + '\n', 'utf8');
    },
  };
}
