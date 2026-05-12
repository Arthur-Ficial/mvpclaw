/**
 * `mvpclaw tool` — direct ToolRegistry access (list / describe / call).
 *
 * Three sub-commands:
 *   - list                  — every registered tool (filterable by --source)
 *   - describe <name>       — definition + JSON schema for one tool
 *   - call <name> --input X — invoke the tool. Input is JSON; pass
 *                             `@path/to/file` to read from a file or `-`
 *                             to read from stdin.
 */
import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { exitConfig, exitNotFound, exitRuntime, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

function open(args: Record<string, unknown>): ReturnType<typeof buildAppContext> {
  try {
    const config = loadConfig(typeof args['config'] === 'string' ? args['config'] : undefined);
    return buildAppContext(config);
  } catch (err) {
    exitConfig(err instanceof Error ? err.message : String(err));
  }
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List every registered tool.' },
  args: {
    ...commonArgs,
    source: {
      type: 'string',
      description: 'Filter by source (builtin|mcp|openrouter-server|anthropic|gemini).',
      required: false,
    },
    'enabled-only': {
      type: 'boolean',
      description: 'Skip disabled tools.',
      default: false,
    },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      let defs = built.ctx.tools.describe();
      if (typeof args.source === 'string' && args.source.length > 0) {
        defs = defs.filter((d) => d.source === args.source);
      }
      if (args['enabled-only']) {
        defs = defs.filter((d) => d.enabled);
      }
      writeOut(
        defs.map((d) => ({
          name: d.name,
          source: d.source,
          enabled: d.enabled,
          description: d.description,
        })),
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
  },
});

const describeCmd = defineCommand({
  meta: { name: 'describe', description: 'Show a tool definition (description + JSON schema).' },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Tool name.', required: true },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const handler = built.ctx.tools.get(String(args.name));
      if (!handler) {
        exitNotFound(`tool "${String(args.name)}" not found`);
      }
      writeOut(handler.definition, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const callCmd = defineCommand({
  meta: { name: 'call', description: 'Invoke a tool by name with --input JSON.' },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Tool name.', required: true },
    input: {
      type: 'string',
      description: 'JSON input. Use `@path/to/file` to read from a file or `-` for stdin.',
      default: '{}',
    },
    'chat-id': {
      type: 'string',
      description: 'Internal chat id (for tools that need chat context).',
      required: false,
    },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      let raw = typeof args.input === 'string' ? args.input : '{}';
      if (raw === '-') {
        raw = readFileSync(0, 'utf8');
      } else if (raw.startsWith('@')) {
        const path = raw.slice(1);
        if (!existsSync(path)) {
          exitUsage(`--input file not found: ${path}`);
        }
        raw = readFileSync(path, 'utf8');
      }
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch (err) {
        exitUsage(`--input is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        const result = await built.ctx.tools.call(String(args.name), input, {
          db: built.ctx.db,
          ...(typeof args['chat-id'] === 'string' ? { chatId: args['chat-id'] } : {}),
        });
        writeOut(result, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('no such tool')) {
          exitNotFound(msg);
        }
        exitRuntime(msg);
      }
    } finally {
      built.ctx.db.close();
    }
  },
});

export const toolCmd = defineCommand({
  meta: { name: 'tool', description: 'List / describe / call any registered tool directly.' },
  args: { ...commonArgs },
  subCommands: { list: listCmd, describe: describeCmd, call: callCmd },
});
