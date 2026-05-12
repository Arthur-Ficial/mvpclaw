/**
 * MCP area — Model Context Protocol stdio client + two internal servers
 * (`mvpclaw-tools`, `mvpclaw-conversations`).
 *
 * The client is used during agent runs to talk to external MCP servers
 * configured under `config.mcp.servers`. The two internal servers are
 * spawned by Claude CLI / OpenRouter via the generated `--mcp-config`
 * snapshot from `mcp-config.ts`, so the AI can introspect MVPClaw's own
 * tools and conversation state.
 */
export { connectMcpClient } from './mcp-client.js';
export type {
  McpClient,
  McpClientOptions,
  RemoteToolDescription,
  RemoteToolResult,
} from './mcp-client.js';
export { runMcpServer } from './mcp-server.js';
export type { McpServerTool, McpServerInfo, McpServerOptions } from './mcp-server.js';
export { runMvpClawToolsServer, buildMcpToolsList } from './mcp-tools-server.js';
export {
  runMvpClawConversationsServer,
  buildConversationsToolsList,
} from './mcp-conversations-server.js';
export { buildMcpConfigSnapshot } from './mcp-config.js';
export { encodeFrame, decodeFrame, jsonRpcRequest } from './jsonrpc.js';
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './jsonrpc.js';
