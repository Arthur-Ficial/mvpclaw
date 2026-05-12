/**
 * MCP stdio client — spawn an MCP server and round-trip JSON-RPC requests.
 *
 * Small surface: `connect()` to start a child process and run the MCP
 * handshake (`initialize` + `notifications/initialized`); `listTools()`
 * to fetch `tools/list`; `callTool()` to fetch `tools/call`; `close()`
 * to terminate. Per the spec, MCP is a session — clients keep the same
 * stdio handle open for the lifetime of the agent run.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  decodeFrame,
  encodeFrame,
  jsonRpcRequest,
  type JsonRpcResponse,
} from './jsonrpc.js';

/** A tool discovered via `tools/list`. */
export interface RemoteToolDescription {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Result of a `tools/call`. Content is the MCP content array. */
export interface RemoteToolResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}

/** Options for spawning an MCP server. */
export interface McpClientOptions {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  /** Wall-clock cap on a single request. */
  requestTimeoutMs?: number;
}

/** A connected MCP client. */
export interface McpClient {
  listTools(): Promise<RemoteToolDescription[]>;
  callTool(name: string, input: unknown): Promise<RemoteToolResult>;
  close(): Promise<void>;
}

/**
 * Spawn an MCP server and complete the handshake.
 *
 * @param opts - command/args/env/timeout.
 * @returns A connected `McpClient`.
 */
export async function connectMcpClient(opts: McpClientOptions): Promise<McpClient> {
  const child: ChildProcessWithoutNullStreams = spawn(opts.command, [...opts.args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  const timeoutMs = opts.requestTimeoutMs ?? 30_000;
  let closed = false;

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  (async (): Promise<void> => {
    for await (const line of rl) {
      const frame = decodeFrame(line.trim());
      if (!frame || !('id' in frame)) {
        continue;
      }
      const id = (frame as JsonRpcResponse).id;
      if (typeof id !== 'number') {
        continue;
      }
      const callbacks = pending.get(id);
      if (!callbacks) {
        continue;
      }
      pending.delete(id);
      if ((frame as JsonRpcResponse).error) {
        const e = (frame as JsonRpcResponse).error!;
        callbacks.reject(new Error(`MCP error ${e.code}: ${e.message}`));
      } else {
        callbacks.resolve((frame as JsonRpcResponse).result);
      }
    }
  })().catch(() => {
    /* stream closed */
  });

  function call<T>(method: string, params: unknown): Promise<T> {
    if (closed) {
      return Promise.reject(new Error('MCP client closed'));
    }
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(encodeFrame(jsonRpcRequest(id, method, params)));
    });
  }

  // Handshake.
  await call<unknown>('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mvpclaw', version: '0.3.0' },
  });
  child.stdin.write(encodeFrame({ jsonrpc: '2.0', method: 'notifications/initialized' }));

  return {
    async listTools() {
      const result = (await call<{ tools: RemoteToolDescription[] }>('tools/list', {})) ?? {
        tools: [],
      };
      return result.tools;
    },
    async callTool(name, input) {
      return call<RemoteToolResult>('tools/call', { name, arguments: input });
    },
    async close() {
      closed = true;
      child.stdin.end();
      child.kill();
      for (const cb of pending.values()) {
        cb.reject(new Error('MCP client closed'));
      }
      pending.clear();
    },
  };
}
