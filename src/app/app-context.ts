/**
 * `AppContext` — the typed DI container passed to every orchestrator
 * function. One place that knows the config, the DB handle, the logger,
 * the channels, and the agent providers.
 *
 * Construction is done once at boot (see `buildAppContext`). Tests build a
 * temp `AppContext` against a temp DB, a real OpenRouter free-model
 * provider, and the `cli-inject` channel — no fakes, just a smaller
 * scope.
 *
 * The orchestrator never reaches outside this object — that's how we keep
 * "external call injectable for tests" honest.
 */
import type { Logger } from 'pino';
import type { AgentProviderAdapter } from '../agent/index.js';
import type { ChannelAdapter } from '../channels/index.js';
import type { MvpClawConfigType } from '../config/index.js';
import type { Db } from '../db/index.js';

/** The DI container the orchestrator threads through every call. */
export interface AppContext {
  /** Resolved configuration (frozen). */
  readonly config: MvpClawConfigType;
  /** Pino logger (writes to stderr). */
  readonly log: Logger;
  /** Open SQLite handle. */
  readonly db: Db;
  /** All channel adapters keyed by `channel.name`. */
  readonly channels: Readonly<Record<string, ChannelAdapter>>;
  /** All agent providers keyed by `provider.name`. */
  readonly providers: Readonly<Record<string, AgentProviderAdapter>>;
  /** Directory where per-run JSONL traces are written. */
  readonly tracesDir: string;
}
