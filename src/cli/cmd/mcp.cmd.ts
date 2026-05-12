/**
 * `mvpclaw mcp` — list / inspect / test MCP servers (internal + external).
 *
 * Full implementation arrives in ticket C10 (#34).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const mcpCmd = defineCommand({
  meta: {
    name: 'mcp',
    description: 'List / inspect / test MCP servers.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('mcp', 'C10 / #34'),
});
