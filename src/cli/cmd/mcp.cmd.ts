/**
 * `mvpclaw mcp` — list / inspect / test MCP servers.
 *
 * `list` reads `config.mcp.servers` + the two internal servers (mvpclaw-tools,
 * mvpclaw-conversations) and prints them as a table. `inspect` and `test`
 * require a live MCP transport, which P8 will wire — they stub-exit 3 today
 * with a clear "delivered by P8" message.
 */
import { defineCommand } from 'citty';
import { loadConfig } from '../../config/index.js';
import { exitConfig } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs, notYetImplemented } from './_common.js';

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List configured + internal MCP servers.' },
  args: { ...commonArgs },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const internal: Array<{ name: string; kind: string; exposed: boolean }> = [];
    if (config.mcp.expose.toolsServer) {
      internal.push({ name: 'mvpclaw-tools', kind: 'internal-stdio', exposed: true });
    }
    if (config.mcp.expose.conversationsServer) {
      internal.push({ name: 'mvpclaw-conversations', kind: 'internal-stdio', exposed: true });
    }
    const external = Object.entries(config.mcp.servers).map(([name, value]) => ({
      name,
      kind: 'external',
      config: value as unknown,
    }));
    writeOut({ enabled: config.mcp.enabled, internal, external }, ctx);
  },
});

const inspectCmd = defineCommand({
  meta: { name: 'inspect', description: 'Fetch tools/list from an MCP server (needs P8).' },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Server name.', required: true },
  },
  run: () => notYetImplemented('mcp inspect', 'P8 / #14'),
});

const testCmd = defineCommand({
  meta: {
    name: 'test',
    description: 'Round-trip a tools/list call against an MCP server (needs P8).',
  },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Server name.', required: true },
  },
  run: () => notYetImplemented('mcp test', 'P8 / #14'),
});

export const mcpCmd = defineCommand({
  meta: { name: 'mcp', description: 'List / inspect / test MCP servers.' },
  args: { ...commonArgs },
  subCommands: { list: listCmd, inspect: inspectCmd, test: testCmd },
});
