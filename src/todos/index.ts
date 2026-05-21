/**
 * TODO area — the bot's durable task list.
 *
 * Two markdown files under the bot's runtime workspace:
 *   - `TODO.md`       — open items, append-only via `todo_add`
 *   - `DONE-TASKS.md` — closed items, append-only via `todo_done`
 *
 * Both are plain markdown so the owner can read them from any terminal without
 * tools, and the bot can `bash_exec cat TODO.md` from its workspace pwd.
 */
export {
  TODO_SOURCES,
  todoAdd,
  todoDone,
  todoList,
  todoPath,
  donePath,
  workspaceDir,
} from './todos-store.js';
export type { TodoRow, DoneRow, TodoSource, TodoListFilter } from './todos-store.js';
export { registerTodoTools } from './todos-tools.js';
