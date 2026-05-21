/**
 * Filesystem read power tools — `read_file` and `list_dir`. Both are gated by
 * `power.readFs` and resolve a leading `~` to the host home directory.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ToolHandler } from '../tool.js';

/**
 * Build the `read_file` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function readFileTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'read_file',
      description:
        'Read a file from disk. Returns up to 256KB of content. Use list_dir first if you do not know the path.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Absolute or home-relative path.' },
          maxBytes: { type: 'integer', minimum: 1, maximum: 262_144, default: 65_536 },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ path: string; bytes: number; content: string }> {
      if (!enabled) {
        throw new Error('read_file is disabled — set power.readFs to true');
      }
      const p = input as { path: string; maxBytes?: number };
      const abs = resolve(p.path.replace(/^~(?=$|\/)/, homedir()));
      const max = p.maxBytes ?? 65_536;
      const buf = readFileSync(abs).subarray(0, max);
      return Promise.resolve({ path: abs, bytes: buf.length, content: buf.toString('utf8') });
    },
  };
}

/**
 * Build the `list_dir` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function listDirTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'list_dir',
      description: 'List directory entries. Returns up to 200 entries with type + size.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<Array<{ name: string; kind: 'file' | 'dir' | 'other'; size: number }>> {
      if (!enabled) {
        throw new Error('list_dir is disabled — set power.readFs to true');
      }
      const p = input as { path: string; limit?: number };
      const abs = resolve(p.path.replace(/^~(?=$|\/)/, homedir()));
      const names = readdirSync(abs).slice(0, p.limit ?? 200);
      return Promise.resolve(
        names.map((name) => {
          const full = join(abs, name);
          try {
            const s = statSync(full);
            return {
              name,
              kind: (s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other') as
                | 'file'
                | 'dir'
                | 'other',
              size: s.size,
            };
          } catch {
            return { name, kind: 'other' as const, size: 0 };
          }
        }),
      );
    },
  };
}
