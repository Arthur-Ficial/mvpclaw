/**
 * Internal MCP server: `mvpclaw-tools`.
 *
 * Exposes the project's built-in tools (datetime, status, scheduler, memory,
 * etc.) over MCP stdio so Claude CLI and any other MCP-aware client can
 * discover and call them. Backed by the live `ToolRegistry` — the surface
 * stays in lock-step with whatever is enabled at boot.
 */
import { loadConfig } from '../config/index.js';
import { applyMigrations, openDb, pathFromUrl } from '../db/index.js';
import { registerMemoryTools } from '../memory/index.js';
import {
  createToolRegistry,
  registerBuiltinTools,
  registerExternalTools,
  registerSchedulerTools,
  type ToolRegistry,
} from '../tools/index.js';
import { runMcpServer, type McpServerTool } from './mcp-server.js';

/**
 * Build the tool list that the `mvpclaw-tools` server exposes. Each MCP
 * tool wraps a `ToolHandler` execute call with the standard MCP result
 * shape (`content: [{type:'text',text}]`).
 *
 * @param registry - The live ToolRegistry whose tools to wrap.
 * @returns A list of `McpServerTool` ready for `runMcpServer`.
 */
export function buildMcpToolsList(registry: ToolRegistry): McpServerTool[] {
  return registry
    .list()
    .filter((h) => h.definition.enabled && h.definition.source === 'builtin')
    .map((h) => ({
      name: h.definition.name,
      description: h.definition.description,
      inputSchema: h.definition.inputSchema,
      async call(input) {
        const result = await h.execute(input, { db: registryDb(registry) });
        return {
          content: [
            { type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result) },
          ],
        };
      },
    }));
}

/**
 * Entry point invoked by `mvpclaw mcp serve mvpclaw-tools`. Opens its own
 * SQLite connection (the parent process has its own; subprocesses do not
 * inherit JS handles), registers built-in + external + scheduler + memory
 * tools, and serves until stdin closes.
 */
export async function runMvpClawToolsServer(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const db = openDb(pathFromUrl(config.database.url));
  applyMigrations(db, 'migrations');
  const registry = createToolRegistry();
  registerBuiltinTools(registry, { config, getSkills: () => [] });
  registerExternalTools(registry, config, process.env);
  registerSchedulerTools(registry);
  registerMemoryTools(registry, { redactEnvNames: config.logging.redact });
  // Memo'd handle so the per-tool execute calls can reach the DB without
  // each one re-opening it.
  registryDbMap.set(registry, db);
  try {
    await runMcpServer({
      info: { name: 'mvpclaw-tools', version: '0.3.0' },
      tools: buildMcpToolsList(registry),
    });
  } finally {
    db.close();
  }
}

const registryDbMap = new WeakMap<ToolRegistry, ReturnType<typeof openDb>>();

function registryDb(registry: ToolRegistry): ReturnType<typeof openDb> {
  const db = registryDbMap.get(registry);
  if (!db) {
    throw new Error('mvpclaw-tools: registry has no associated DB handle');
  }
  return db;
}
