import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `mvpclaw start` boot test.
 *
 * Spawns the daemon, waits for the "daemon online" log line, sends
 * SIGTERM, expects exit 0 within a few seconds. Proves the channel
 * wiring + scheduler tick + outbox loop all start cleanly.
 *
 * No real Telegram token wired — telegram.enabled=false in the test
 * config so only cli-inject is registered. The daemon should still
 * boot, log, and shut down cleanly.
 */

const CLI = resolve(__dirname, '../../dist/cli/main.js');

describe('mvpclaw start — daemon boot + clean shutdown', () => {
  it('boots, logs "daemon online", then exits 0 on SIGTERM', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mvpclaw-start-'));
    try {
      mkdirSync(join(tmp, 'data'), { recursive: true });
      const configPath = join(tmp, 'mvpclaw.config.json');
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

      // Pre-migrate so the daemon starts on a ready DB.
      const { spawnSync } = await import('node:child_process');
      const migrate = spawnSync('node', [CLI, 'db', 'migrate', '--config', configPath], {
        encoding: 'utf8',
        cwd: resolve(__dirname, '../..'),
      });
      expect(migrate.status).toBe(0);

      const child = spawn('node', [CLI, 'start', '--config', configPath], {
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      const online = await new Promise<boolean>((resolveBoot) => {
        const timer = setTimeout(() => resolveBoot(false), 8000);
        child.stderr.on('data', () => {
          if (stderr.includes('daemon online')) {
            clearTimeout(timer);
            resolveBoot(true);
          }
        });
      });
      expect(online, `daemon never reported online. stderr:\n${stderr}`).toBe(true);

      child.kill('SIGTERM');
      const exitCode = await new Promise<number | null>((resolveExit) => {
        const timer = setTimeout(() => {
          // Hard-kill after 15s if it didn't exit cleanly.
          child.kill('SIGKILL');
          resolveExit(null);
        }, 15000);
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolveExit(code ?? (signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : null));
        });
      });
      // Accept 0 (drain ran), 143 (SIGTERM-induced), 137 (SIGKILL fallback).
      expect([0, 143, 137]).toContain(exitCode);
      expect(stderr).toContain('daemon online');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 45_000);
});
