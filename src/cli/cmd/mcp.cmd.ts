/**
 * `mvpclaw mcp` — list / inspect / test / serve MCP servers.
 *
 *   list     — print configured external servers + the two internal stdio
 *              servers (`mvpclaw-tools`, `mvpclaw-conversations`).
 *   inspect  — spawn a server, send `tools/list`, print the result.
 *   test     — round-trip `initialize` + `tools/list`, exit 0 on success.
 *   serve    — `serve mvpclaw-tools` or `serve mvpclaw-conversations` —
 *              run one of the two internal servers on stdio.
 */
import { defineCommand } from 'citty';
import { loadConfig } from '../../config/index.js';
import {
  connectMcpClient,
  runMvpClawToolsServer,
  runMvpClawConversationsServer,
} from '../../mcp/index.js';
import { exitConfig, exitNotFound, exitRuntime } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

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

function resolveServerSpec(
  config: ReturnType<typeof loadConfig>,
  name: string,
): { command: string; args: string[]; env?: Record<string, string> } {
  if (name === 'mvpclaw-tools' || name === 'mvpclaw-conversations') {
    return {
      command: process.execPath,
      args: [process.argv[1] ?? 'dist/cli/main.js', 'mcp', 'serve', name],
    };
  }
  const raw = config.mcp.servers[name] as
    | { command?: string; args?: string[]; env?: Record<string, string> }
    | undefined;
  if (!raw || typeof raw.command !== 'string') {
    exitNotFound(`mcp server "${name}" is not configured`);
  }
  return {
    command: raw.command as string,
    args: Array.isArray(raw.args) ? raw.args : [],
    ...(raw.env ? { env: raw.env } : {}),
  };
}

const inspectCmd = defineCommand({
  meta: { name: 'inspect', description: 'Fetch tools/list from an MCP server.' },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Server name.', required: true },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const spec = resolveServerSpec(config, String(args.name));
    const client = await connectMcpClient(spec);
    try {
      const tools = await client.listTools();
      writeOut({ server: String(args.name), tools }, ctx);
    } catch (err) {
      exitRuntime(err instanceof Error ? err.message : String(err));
    } finally {
      await client.close();
    }
  },
});

const testCmd = defineCommand({
  meta: {
    name: 'test',
    description: 'Round-trip initialize + tools/list against an MCP server.',
  },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'Server name.', required: true },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const spec = resolveServerSpec(config, String(args.name));
    const client = await connectMcpClient(spec);
    try {
      const tools = await client.listTools();
      writeOut({ ok: true, server: String(args.name), toolCount: tools.length }, ctx);
    } catch (err) {
      exitRuntime(err instanceof Error ? err.message : String(err));
    } finally {
      await client.close();
    }
  },
});

const serveCmd = defineCommand({
  meta: { name: 'serve', description: 'Run an internal MCP server on stdio.' },
  args: {
    ...commonArgs,
    name: { type: 'positional', description: 'mvpclaw-tools | mvpclaw-conversations.', required: true },
  },
  async run({ args }) {
    const name = String(args.name);
    const configPath = typeof args.config === 'string' ? args.config : undefined;
    if (name === 'mvpclaw-tools') {
      await runMvpClawToolsServer(configPath);
      return;
    }
    if (name === 'mvpclaw-conversations') {
      await runMvpClawConversationsServer(configPath);
      return;
    }
    exitNotFound(`no internal MCP server named "${name}"`);
  },
});

export const mcpCmd = defineCommand({
  meta: { name: 'mcp', description: 'List / inspect / test / serve MCP servers.' },
  args: { ...commonArgs },
  subCommands: { list: listCmd, inspect: inspectCmd, test: testCmd, serve: serveCmd },
});
