/**
 * Minimal JSON-RPC 2.0 framing helpers. MCP runs JSON-RPC over stdio with
 * line-delimited JSON (one request/response per line). No batching here.
 */

/** A JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/** A JSON-RPC 2.0 notification (no `id`). */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** A JSON-RPC 2.0 response. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Build a request object. */
export function jsonRpcRequest(id: number | string, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params };
}

/** Serialise an object as one JSON-RPC frame (single line + `\n`). */
export function encodeFrame(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

/**
 * Parse one inbound line into a request/response/notification or null when
 * malformed. We never throw on malformed lines — MCP servers must keep
 * serving even when peer sends garbage.
 *
 * @param line - One line of stdin.
 * @returns The parsed object, or `null` on parse error.
 */
export function decodeFrame(line: string): JsonRpcRequest | JsonRpcResponse | JsonRpcNotification | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed['jsonrpc'] !== '2.0') {
      return null;
    }
    return parsed as unknown as JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
  } catch {
    return null;
  }
}
