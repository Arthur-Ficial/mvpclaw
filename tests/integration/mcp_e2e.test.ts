import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connectMcpClient } from '../../src/mcp/index.js';

/**
 * MCP end-to-end — spawns the real internal `mvpclaw-tools` MCP server
 * (the compiled binary), connects with the real MCP stdio client, and
 * exercises initialize + tools/list + tools/call against a live registry.
 * NO FAKE TRANSPORT: same JSON-RPC framing as Claude CLI would use.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');

describe('MCP — real client + real server round-trip', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-mcp-e2e-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    configPath = join(tmp, 'mvpclaw.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        app: { dataDir: join(tmp, 'data'), workspaceDir: join(tmp, 'workspace') },
        database: { url: `file:${join(tmp, 'data', 'mvpclaw.sqlite')}` },
        agent: { provider: 'openrouter' },
        openrouter: { enabled: false },
        telegram: { enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN_UNSET' },
      }),
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('initialize + tools/list returns the built-in tools', async () => {
    const client = await connectMcpClient({
      command: process.execPath,
      args: [CLI, 'mcp', 'serve', 'mvpclaw-tools', '--config', configPath],
      env: { MVPCLAW_CONFIG: configPath },
    });
    try {
      const tools = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      // Built-ins from src/tools/builtins.ts + scheduler tools + memory tools.
      expect(names).toContain('mvpclaw_datetime');
      expect(names).toContain('mvpclaw_status');
      expect(names).toContain('schedule_task');
      expect(names).toContain('memory_read');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('tools/call mvpclaw_datetime round-trips ISO + epoch', async () => {
    const client = await connectMcpClient({
      command: process.execPath,
      args: [CLI, 'mcp', 'serve', 'mvpclaw-tools', '--config', configPath],
      env: { MVPCLAW_CONFIG: configPath },
    });
    try {
      const result = await client.callTool('mvpclaw_datetime', {});
      expect(result.content.length).toBeGreaterThan(0);
      const first = result.content[0];
      expect(first?.type).toBe('text');
      const parsed = JSON.parse(first?.text ?? '{}') as { iso?: string; unix?: number };
      expect(parsed.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(parsed.unix).toBeGreaterThan(1_700_000_000);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('conversations server lists chats + recent runs', async () => {
    const client = await connectMcpClient({
      command: process.execPath,
      args: [CLI, 'mcp', 'serve', 'mvpclaw-conversations', '--config', configPath],
      env: { MVPCLAW_CONFIG: configPath },
    });
    try {
      const tools = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        [
          'get_active_session',
          'get_run',
          'list_chats',
          'list_recent_runs',
          'read_recent_messages',
        ].sort(),
      );
      const result = await client.callTool('list_chats', { limit: 5 });
      const parsed = JSON.parse(result.content[0]?.text ?? '[]') as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);
});
