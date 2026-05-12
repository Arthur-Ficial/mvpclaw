import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `mvpclaw tool` e2e — exercises the ToolRegistry through the compiled binary.
 *
 * No provider calls needed; tools are local. No env gating.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');
const REPO_ROOT = resolve(__dirname, '../..');

describe('mvpclaw tool — end-to-end through compiled binary', () => {
  let tmp: string;
  let configPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-tool-e2e-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    configPath = join(tmp, 'mvpclaw.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        app: { dataDir: join(tmp, 'data'), workspaceDir: join(tmp, 'workspace') },
        database: { url: `file:${join(tmp, 'data', 'mvpclaw.sqlite')}` },
        agent: { provider: 'openrouter' },
        openrouter: { enabled: true },
        telegram: { enabled: false, tokenEnv: 'TELEGRAM_BOT_TOKEN_UNSET' },
      }),
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('node', [CLI, ...args, '--config', configPath], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: 30_000,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it('list returns 19 built-in (5 mvpclaw + 4 scheduler + 2 memory + 8 power) + 2 external tools', () => {
    const r = runCli(['tool', 'list', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const tools = JSON.parse(r.stdout) as Array<{ name: string; source: string; enabled: boolean }>;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'anthropic_web_search',
        'bash_exec',
        'cancel_task',
        'claude_spawn',
        'codex_spawn',
        'gemini_image',
        'gemini_research',
        'list_dir',
        'list_tasks',
        'memory_append',
        'memory_read',
        'mvpclaw_datetime',
        'mvpclaw_list_skills',
        'mvpclaw_read_recent_messages',
        'mvpclaw_read_skill',
        'mvpclaw_status',
        'read_file',
        'schedule_task',
        'screenshot',
        'telegram_photo',
        'update_task',
      ].sort(),
    );
    // External tools are registered but disabled without keys.
    const anthropic = tools.find((t) => t.name === 'anthropic_web_search');
    const gemini = tools.find((t) => t.name === 'gemini_research');
    expect(anthropic?.source).toBe('anthropic');
    expect(gemini?.source).toBe('gemini');
    // Without ANTHROPIC_API_KEY / GEMINI_API_KEY set, these are disabled.
    if (!process.env['ANTHROPIC_API_KEY']) {
      expect(anthropic?.enabled).toBe(false);
    }
    if (!process.env['GEMINI_API_KEY']) {
      expect(gemini?.enabled).toBe(false);
    }
  });

  it('list --source builtin returns 19 tools (5 mvpclaw + 4 scheduler + 2 memory + 8 power)', () => {
    const r = runCli(['tool', 'list', '--source', 'builtin', '--json']);
    expect(r.status).toBe(0);
    const tools = JSON.parse(r.stdout) as Array<{ name: string }>;
    expect(tools.length).toBe(19);
  });

  it('list --source anthropic returns the web-search tool', () => {
    const r = runCli(['tool', 'list', '--source', 'anthropic', '--json']);
    expect(r.status).toBe(0);
    const tools = JSON.parse(r.stdout) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['anthropic_web_search']);
  });

  it('list --source gemini returns the research tool', () => {
    const r = runCli(['tool', 'list', '--source', 'gemini', '--json']);
    expect(r.status).toBe(0);
    const tools = JSON.parse(r.stdout) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['gemini_research']);
  });

  it('calling anthropic_web_search when disabled returns exit 3 with a clear error', () => {
    if (process.env['ANTHROPIC_API_KEY']) {
      // Key is set — skip; real-provider behavior depends on rate limits.
      return;
    }
    const r = runCli([
      'tool',
      'call',
      'anthropic_web_search',
      '--input',
      '{"query":"x"}',
      '--json',
    ]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('disabled');
  });

  it('list --source mcp returns empty (MCP lands in P8)', () => {
    const r = runCli(['tool', 'list', '--source', 'mcp', '--json']);
    expect(r.status).toBe(0);
    const tools = JSON.parse(r.stdout) as unknown[];
    expect(tools).toEqual([]);
  });

  it('describe mvpclaw_datetime returns the full definition', () => {
    const r = runCli(['tool', 'describe', 'mvpclaw_datetime', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const def = JSON.parse(r.stdout) as { name: string; inputSchema: { type: string } };
    expect(def.name).toBe('mvpclaw_datetime');
    expect(def.inputSchema.type).toBe('object');
  });

  it('describe unknown returns exit 4', () => {
    const r = runCli(['tool', 'describe', 'not-a-real-tool', '--json']);
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('not found');
  });

  it('call mvpclaw_datetime returns ISO 8601 + epoch', () => {
    const r = runCli(['tool', 'call', 'mvpclaw_datetime', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const result = JSON.parse(r.stdout) as { iso: string; unix: number };
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result.unix).toBeGreaterThan(1_700_000_000);
  });

  it('call mvpclaw_status returns provider + key presence (never values)', () => {
    const r = runCli(['tool', 'call', 'mvpclaw_status', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const result = JSON.parse(r.stdout) as {
      provider: string;
      telegramConfigured: string;
      openrouterConfigured: string;
    };
    expect(result.provider).toBe('openrouter');
    expect(['Yes', 'No']).toContain(result.telegramConfigured);
    expect(['Yes', 'No']).toContain(result.openrouterConfigured);
    // Never the raw key.
    const key = process.env['OPENROUTER_API_KEY'];
    if (typeof key === 'string' && key.length > 0) {
      expect(r.stdout).not.toContain(key);
    }
  });

  it('call bogus tool returns exit 4', () => {
    const r = runCli(['tool', 'call', 'not-a-real-tool', '--input', '{}', '--json']);
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('no such tool');
  });

  it('call with bad JSON input returns exit 1 (usage)', () => {
    const r = runCli(['tool', 'call', 'mvpclaw_datetime', '--input', 'not json', '--json']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not valid JSON');
  });
});
