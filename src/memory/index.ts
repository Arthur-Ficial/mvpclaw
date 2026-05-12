/**
 * Memory area — agent self-memory tools (`memory_read`, `memory_append`).
 *
 * Two scopes — a runtime file (CLAUDE.local.md under the workspace) and
 * per-chat memory (SQLite). Append-only via the tool surface; only the
 * human-facing CLI `mvpclaw memory clear` can shrink memory.
 */
export { registerMemoryTools, MEMORY_LIMITS } from './memory-tools.js';
