/**
 * Database area — SQLite is the single source of runtime truth.
 *
 * One connection factory (`openDb`), one migration runner (`applyMigrations`),
 * and tiny repos in `repos/` that hold no business logic — just typed
 * prepared statements. The driver is `better-sqlite3` (synchronous,
 * prepared-statement first) chosen over Drizzle for readability.
 *
 * All writes go through repo functions; nothing else in the codebase
 * constructs SQL strings. Foreign keys are ON; WAL is the journal mode.
 */
export { openDb, pathFromUrl } from './db.js';
export type { Db } from './db.js';
export { applyMigrations } from './migrate.js';

export * as ChatsRepo from './repos/chats.repo.js';
export * as SessionsRepo from './repos/sessions.repo.js';
export * as MessagesRepo from './repos/messages.repo.js';
export * as RunsRepo from './repos/runs.repo.js';
export * as OutboxRepo from './repos/outbox.repo.js';
export * as TasksRepo from './repos/tasks.repo.js';
export * as ChatMemoryRepo from './repos/chat-memory.repo.js';
export * as ToolCallsRepo from './repos/tool-calls.repo.js';

// Row types re-exported flat so consumers can `import type { ChatRow } from '../db/index.js'`.
export type { ChatRow } from './repos/chats.repo.js';
export type { SessionRow } from './repos/sessions.repo.js';
export type { MessageRow } from './repos/messages.repo.js';
export type { AgentRunRow } from './repos/runs.repo.js';
export type { OutboxRow, OutboxStatus } from './repos/outbox.repo.js';
export type { TaskRow, TaskState, TaskInsert, TaskListFilters } from './repos/tasks.repo.js';
