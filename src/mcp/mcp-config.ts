/**
 * Build a generated MCP config snapshot for one agent run.
 *
 * Claude CLI consumes a JSON file describing MCP servers via --mcp-config.
 * The shape is: a `servers` map keyed by server name, where each value
 * has `command`, `args`, and optional `env`.
 * This module derives that shape from `MvpClawConfig.mcp` plus the two
 * internal servers when `expose.toolsServer` / `expose.conversationsServer`
 * is true. Internal servers are spawned via the same compiled CLI entry
 * point so they pick up the same dist as the host process.
 */
import { resolve } from 'node:path';
import type { MvpClawConfigType } from '../config/index.js';
import type { McpConfigSnapshot } from '../agent/index.js';

/**
 * Build the `McpConfigSnapshot` to hand to a provider.
 *
 * @param config - The active config.
 * @param distRoot - Project root used to compute the absolute path of the
 *                   compiled CLI entry (so the spawned child runs the same
 *                   build the host is running).
 * @returns The snapshot Claude CLI consumes via `--mcp-config`.
 */
export function buildMcpConfigSnapshot(
  config: MvpClawConfigType,
  distRoot: string,
): McpConfigSnapshot {
  const servers: McpConfigSnapshot['servers'] = {};
  if (config.mcp.enabled) {
    if (config.mcp.expose.toolsServer) {
      servers['mvpclaw-tools'] = {
        command: process.execPath,
        args: [resolve(distRoot, 'dist/cli/main.js'), 'mcp', 'serve', 'mvpclaw-tools'],
      };
    }
    if (config.mcp.expose.conversationsServer) {
      servers['mvpclaw-conversations'] = {
        command: process.execPath,
        args: [resolve(distRoot, 'dist/cli/main.js'), 'mcp', 'serve', 'mvpclaw-conversations'],
      };
    }
    for (const [name, value] of Object.entries(config.mcp.servers)) {
      const v = value as { command?: string; args?: string[]; env?: Record<string, string> };
      if (typeof v.command === 'string') {
        servers[name] = {
          command: v.command,
          args: Array.isArray(v.args) ? v.args : [],
          ...(v.env ? { env: v.env } : {}),
        };
      }
    }
  }
  return { servers };
}
