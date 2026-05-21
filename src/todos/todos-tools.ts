/**
 * MCP tools that wrap `todos-store.ts` for agent use.
 *
 * Three tools, all `source: 'builtin'`:
 *   - `todo_add`  — append a new open todo
 *   - `todo_done` — move a todo to DONE-TASKS.md with optional note
 *   - `todo_list` — list 'open' or 'done' rows
 */
import type { ToolHandler } from '../tools/tool.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { TODO_SOURCES, todoAdd, todoDone, todoList, type TodoSource } from './todos-store.js';

/** Register all three todo tools on `registry`. */
export function registerTodoTools(registry: ToolRegistry): void {
  registry.register(todoAddTool());
  registry.register(todoDoneTool());
  registry.register(todoListTool());
}

function todoAddTool(): ToolHandler {
  return {
    definition: {
      name: 'todo_add',
      description:
        'Append a new TODO to ~/.mvpclaw/workspaces/default/TODO.md. ' +
        'Use whenever something needs follow-up but you cannot finish it now (e.g. external dependency, ' +
        'Owner needs to decide, you are throttled on proactive asks). text ≤ 280 chars, single line. ' +
        'source identifies where the todo came from.',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 280 },
          source: { type: 'string', enum: [...TODO_SOURCES], default: 'manual' },
        },
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<{ id: string; createdAt: string; source: string; text: string }> {
      const p = input as { text: string; source?: TodoSource };
      return Promise.resolve(todoAdd(p.text, p.source ?? 'manual'));
    },
  };
}

function todoDoneTool(): ToolHandler {
  return {
    definition: {
      name: 'todo_done',
      description:
        'Mark one TODO completed by its id. Removes the row from TODO.md and appends to DONE-TASKS.md ' +
        'with an optional one-line note describing how it was finished.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          note: { type: 'string', maxLength: 280 },
        },
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<{ id: string; closed: boolean; doneAt?: string }> {
      const p = input as { id: string; note?: string };
      const r = todoDone(p.id, p.note);
      if (!r) {
        return Promise.resolve({ id: p.id, closed: false });
      }
      return Promise.resolve({ id: r.id, closed: true, doneAt: r.doneAt });
    },
  };
}

function todoListTool(): ToolHandler {
  return {
    definition: {
      name: 'todo_list',
      description:
        'List todos. filter="open" reads TODO.md; filter="done" reads DONE-TASKS.md. ' +
        'Use before adding a new todo to avoid duplicates.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['open', 'done'], default: 'open' },
        },
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<unknown> {
      const p = input as { filter?: 'open' | 'done' };
      return Promise.resolve(todoList(p.filter ?? 'open'));
    },
  };
}
