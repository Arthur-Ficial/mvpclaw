/**
 * MCP tools that wrap `typed-memory.ts` for agent use.
 *
 * Four tools, all `source: 'builtin'`:
 *   - `memory_save`   — persist a new memory of one of the four typed kinds
 *   - `memory_list`   — list MEMORY.md entries (slug, description, type)
 *   - `memory_get`    — read one memory's frontmatter + body
 *   - `memory_delete` — remove a memory (file + index)
 *
 * The pre-existing `memory_read` / `memory_append` tools (`memory-tools.ts`)
 * stay untouched — those handle the chat-scoped append-only journal. These
 * new tools handle the structured knowledge base.
 */
import type { ToolHandler } from '../tools/tool.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import {
  MEMORY_TYPES,
  memoryDelete,
  memoryGet,
  memoryList,
  memorySave,
  type MemoryType,
} from './typed-memory.js';

/** Register all four typed-memory tools on `registry`. */
export function registerTypedMemoryTools(registry: ToolRegistry): void {
  registry.register(memorySaveTool());
  registry.register(memoryListTool());
  registry.register(memoryGetTool());
  registry.register(memoryDeleteTool());
}

function memorySaveTool(): ToolHandler {
  return {
    definition: {
      name: 'memory_save',
      description:
        'Persist a typed memory to ~/.mvpclaw/workspaces/default/memory/<slug>.md and index it in MEMORY.md. ' +
        'Types: feedback (lesson from failure/success), project (motivation behind current work), ' +
        'reference (pointer to an external system), user (collaboration preference). ' +
        'For type=feedback or type=project, body MUST contain both `**Why:**` and `**How to apply:**` lines.',
      inputSchema: {
        type: 'object',
        required: ['slug', 'description', 'type', 'body'],
        properties: {
          slug: { type: 'string', description: 'Short kebab-case identifier, [a-z0-9_-]+' },
          description: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', enum: [...MEMORY_TYPES] },
          body: { type: 'string', minLength: 1, maxLength: 10000 },
        },
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<{ slug: string; type: string; saved: true }> {
      const p = input as { slug: string; description: string; type: MemoryType; body: string };
      const r = memorySave(p);
      return Promise.resolve({ slug: r.name, type: r.metadata.type, saved: true });
    },
  };
}

function memoryListTool(): ToolHandler {
  return {
    definition: {
      name: 'memory_list',
      description:
        'Return every entry in MEMORY.md as {slug, description, type}. Use this to discover ' +
        'whether a prior rule applies before asking the user.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: 'builtin',
      enabled: true,
    },
    execute(): Promise<Array<{ slug: string; description: string; type: string }>> {
      return Promise.resolve(memoryList());
    },
  };
}

function memoryGetTool(): ToolHandler {
  return {
    definition: {
      name: 'memory_get',
      description:
        'Read one memory by slug. Returns the frontmatter + body. Use after `memory_list` ' +
        'identifies a relevant memory.',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: { slug: { type: 'string' } },
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<{
      slug: string;
      description: string;
      type: string;
      createdAt: string;
      body: string;
    }> {
      const p = input as { slug: string };
      const r = memoryGet(p.slug);
      if (!r) {
        throw new Error(`memory_get: slug "${p.slug}" not found`);
      }
      return Promise.resolve({
        slug: r.name,
        description: r.description,
        type: r.metadata.type,
        createdAt: r.metadata.createdAt,
        body: r.body,
      });
    },
  };
}

function memoryDeleteTool(): ToolHandler {
  return {
    definition: {
      name: 'memory_delete',
      description:
        'Remove one memory by slug (file + MEMORY.md index entry). Idempotent. Use sparingly — ' +
        'memories are how the bot accumulates knowledge.',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: { slug: { type: 'string' } },
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<{ slug: string; removed: boolean }> {
      const p = input as { slug: string };
      return Promise.resolve({ slug: p.slug, removed: memoryDelete(p.slug) });
    },
  };
}
