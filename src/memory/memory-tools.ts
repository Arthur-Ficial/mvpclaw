/**
 * Agent self-memory tools — `memory_read` + `memory_append`.
 *
 * Two scopes:
 *   - `runtime` — append-only file at `~/.mvpclaw/workspaces/default/CLAUDE.local.md`
 *   - `chat`    — SQLite-backed per-chat memory keyed by `chat_id`
 *
 * Every `memory_append` runs the text through the project's secret
 * redactor BEFORE writing. Append-only — there is no MCP / tool path
 * that decreases `size_bytes`. The human-only `mvpclaw memory clear` is
 * the only way to shrink memory.
 *
 * Spec §32.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { ChatMemoryRepo } from '../db/index.js';
import { redactString } from '../logging/index.js';
import type { ToolHandler } from '../tools/tool.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

/** Default size caps from spec §32.4. */
export const MEMORY_LIMITS = Object.freeze({
  maxAppendChars: 2000,
  maxFileChars: 200_000,
  maxChatChars: 50_000,
});

/** Resolve `~/.mvpclaw/workspaces/default/CLAUDE.local.md`. */
function runtimeMemoryPath(): string {
  return resolve(homedir(), '.mvpclaw', 'workspaces', 'default', 'CLAUDE.local.md');
}

/** Build a dated append entry (spec §32.3 format). */
function makeEntry(text: string): string {
  return `## ${new Date().toISOString()}\n${text}\n\n`;
}

/** Register both memory tools on `registry`. Requires `config.logging.redact` for the redactor. */
export function registerMemoryTools(
  registry: ToolRegistry,
  options: { redactEnvNames: readonly string[] },
): void {
  registry.register(memoryReadTool());
  registry.register(memoryAppendTool(options.redactEnvNames));
}

function memoryReadTool(): ToolHandler {
  return {
    definition: {
      name: 'memory_read',
      description:
        'Read agent runtime memory (CLAUDE.local.md) or per-chat memory. scope is "runtime" or "chat".',
      inputSchema: {
        type: 'object',
        required: ['scope'],
        properties: {
          scope: { type: 'string', enum: ['runtime', 'chat'] },
          chat_id: { type: 'string', description: 'Required when scope=chat.' },
        },
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input, ctx): Promise<{ scope: string; body: string }> {
      const p = input as { scope: 'runtime' | 'chat'; chat_id?: string };
      if (p.scope === 'runtime') {
        const path = runtimeMemoryPath();
        const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
        return Promise.resolve({ scope: 'runtime', body });
      }
      if (!p.chat_id) {
        throw new Error('memory_read: chat_id is required when scope=chat');
      }
      return Promise.resolve({
        scope: 'chat',
        body: ChatMemoryRepo.readChatMemory(ctx.db, p.chat_id),
      });
    },
  };
}

function memoryAppendTool(redactEnvNames: readonly string[]): ToolHandler {
  return {
    definition: {
      name: 'memory_append',
      description:
        'Append a dated entry to agent memory. Append-only; secret-redacted; max 2000 chars per call.',
      inputSchema: {
        type: 'object',
        required: ['scope', 'text'],
        properties: {
          scope: { type: 'string', enum: ['runtime', 'chat'] },
          text: { type: 'string', minLength: 1, maxLength: MEMORY_LIMITS.maxAppendChars },
          chat_id: { type: 'string', description: 'Required when scope=chat.' },
        },
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input, ctx): Promise<{ scope: string; appendedBytes: number }> {
      const p = input as { scope: 'runtime' | 'chat'; text: string; chat_id?: string };
      if (p.text.length > MEMORY_LIMITS.maxAppendChars) {
        throw new Error(
          `memory_append: text too long (max ${MEMORY_LIMITS.maxAppendChars} chars; got ${p.text.length})`,
        );
      }
      const safe = redactString(p.text, redactEnvNames);
      const entry = makeEntry(safe);
      if (p.scope === 'runtime') {
        const path = runtimeMemoryPath();
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, entry, 'utf8');
        // Rotation: if file exceeds maxFileChars, move to archive.
        const body = readFileSync(path, 'utf8');
        if (body.length > MEMORY_LIMITS.maxFileChars) {
          const archive = path + `.archive-${Date.now()}.md`;
          writeFileSync(archive, body, 'utf8');
          writeFileSync(path, '', 'utf8');
        }
        return Promise.resolve({
          scope: 'runtime',
          appendedBytes: Buffer.byteLength(entry, 'utf8'),
        });
      }
      if (!p.chat_id) {
        throw new Error('memory_append: chat_id is required when scope=chat');
      }
      ChatMemoryRepo.appendChatMemory(ctx.db, p.chat_id, entry);
      // Rotation per chat: if size_bytes > maxChatChars, archive + clear.
      const body = ChatMemoryRepo.readChatMemory(ctx.db, p.chat_id);
      if (body.length > MEMORY_LIMITS.maxChatChars) {
        ChatMemoryRepo.archiveChatMemory(ctx.db, p.chat_id);
      }
      return Promise.resolve({ scope: 'chat', appendedBytes: Buffer.byteLength(entry, 'utf8') });
    },
  };
}
