/**
 * MCP stdio server framework — a tiny reusable JSON-RPC dispatcher that
 * speaks the MCP protocol surface MVPClaw needs (initialize, tools/list,
 * tools/call). Each internal server (`mvpclaw-tools`,
 * `mvpclaw-conversations`) registers its own handlers and calls
 * `runMcpServer()`.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { decodeFrame, encodeFrame } from './jsonrpc.js';

/** A tool exposed by an MCP server. */
export interface McpServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Execute the tool. Return value is sent verbatim as `tools/call.result`. */
  call(input: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

/** Server identity surfaced during the `initialize` handshake. */
export interface McpServerInfo {
  name: string;
  version: string;
}

/** Options for `runMcpServer()`. */
export interface McpServerOptions {
  info: McpServerInfo;
  tools: readonly McpServerTool[];
  /** stdin / stdout. Defaults to process. */
  input?: NodeJS.ReadableStream;
  output?: Writable;
}

/**
 * Run an MCP stdio server. Resolves when stdin closes.
 *
 * @param opts - server identity + tool table + optional stream overrides.
 * @returns A promise that resolves on EOF.
 */
export async function runMcpServer(opts: McpServerOptions): Promise<void> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const rl = createInterface({ input, crlfDelay: Infinity });
  const send = (obj: unknown): void => {
    output.write(encodeFrame(obj));
  };
  for await (const line of rl) {
    const frame = decodeFrame(line.trim());
    if (!frame) {
      continue;
    }
    if (!('method' in frame)) {
      continue;
    }
    if (!('id' in frame)) {
      // Notification — we accept and ignore (initialized, etc.).
      continue;
    }
    const id = frame.id;
    try {
      const result = await handle(frame.method, frame.params, opts);
      send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}

async function handle(
  method: string,
  params: unknown,
  opts: McpServerOptions,
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: opts.info,
      };
    case 'tools/list':
      return {
        tools: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    case 'tools/call': {
      const args = (params ?? {}) as { name?: string; arguments?: unknown };
      const tool = opts.tools.find((t) => t.name === args.name);
      if (!tool) {
        throw new Error(`no such tool: ${String(args.name)}`);
      }
      return tool.call(args.arguments ?? {});
    }
    case 'ping':
      return {};
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
