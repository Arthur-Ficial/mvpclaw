/**
 * Power tools — DANGEROUS by default.
 *
 * Per the maintainer's directive ("super super powerful and unsafe"), the
 * bot ships with shell exec, filesystem read, screenshot capture, and the
 * ability to spawn Claude / Codex / Gemini CLI sub-agents. The agent can
 * see what's on the desktop, analyse the dev folder, run any command the
 * host user can run.
 *
 * Each tool's enablement is gated on `config.power.enabled` (default
 * `true`) so a security-minded operator can flip the whole set off in
 * one place. Individual tools also respect their own config keys.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MvpClawConfigType } from '../config/index.js';
import type { ToolHandler } from './tool.js';
import type { ToolRegistry } from './tool-registry.js';

/**
 * Register the power tools on `registry`.
 *
 * @param registry - The tool registry.
 * @param config - Resolved MVPClaw config.
 */
export function registerPowerTools(registry: ToolRegistry, config: MvpClawConfigType): void {
  const enabled = config.power.enabled;
  registry.register(bashExecTool(enabled && config.power.bashExec));
  registry.register(readFileTool(enabled && config.power.readFs));
  registry.register(listDirTool(enabled && config.power.readFs));
  registry.register(screenshotTool(enabled && config.power.screenshot));
  registry.register(claudeSpawnTool(enabled && config.power.claudeSpawn));
  registry.register(codexSpawnTool(enabled && config.power.codexSpawn));
  registry.register(geminiImageTool(enabled && config.power.geminiImage));
  registry.register(telegramPhotoTool(enabled && config.power.telegramPhoto));
}

// ───────────────────────────── bash_exec ─────────────────────────────

function bashExecTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'bash_exec',
      description:
        'Run a shell command on the host. DANGEROUS — can read/write any file the user can. Returns stdout (truncated to 64KB), stderr, and exit code.',
      inputSchema: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000, default: 30000 },
          cwd: { type: 'string', description: 'Working directory; defaults to home.' },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
      if (!enabled) {
        throw new Error('bash_exec is disabled — set power.enabled and power.bashExec to true');
      }
      const p = input as { command: string; timeoutMs?: number; cwd?: string };
      const r = spawnSync('/bin/bash', ['-lc', p.command], {
        cwd: p.cwd ?? homedir(),
        timeout: p.timeoutMs ?? 30_000,
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
      });
      return Promise.resolve({
        stdout: (r.stdout ?? '').slice(0, 64 * 1024),
        stderr: (r.stderr ?? '').slice(0, 8 * 1024),
        exitCode: r.status,
      });
    },
  };
}

// ───────────────────────────── read_file ─────────────────────────────

function readFileTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'read_file',
      description:
        'Read a file from disk. Returns up to 256KB of content. Use list_dir first if you do not know the path.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Absolute or home-relative path.' },
          maxBytes: { type: 'integer', minimum: 1, maximum: 262_144, default: 65_536 },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ path: string; bytes: number; content: string }> {
      if (!enabled) {
        throw new Error('read_file is disabled — set power.readFs to true');
      }
      const p = input as { path: string; maxBytes?: number };
      const abs = resolve(p.path.replace(/^~(?=$|\/)/, homedir()));
      const max = p.maxBytes ?? 65_536;
      const buf = readFileSync(abs).subarray(0, max);
      return Promise.resolve({ path: abs, bytes: buf.length, content: buf.toString('utf8') });
    },
  };
}

// ───────────────────────────── list_dir ──────────────────────────────

function listDirTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'list_dir',
      description: 'List directory entries. Returns up to 200 entries with type + size.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<Array<{ name: string; kind: 'file' | 'dir' | 'other'; size: number }>> {
      if (!enabled) {
        throw new Error('list_dir is disabled — set power.readFs to true');
      }
      const p = input as { path: string; limit?: number };
      const abs = resolve(p.path.replace(/^~(?=$|\/)/, homedir()));
      const names = readdirSync(abs).slice(0, p.limit ?? 200);
      return Promise.resolve(
        names.map((name) => {
          const full = join(abs, name);
          try {
            const s = statSync(full);
            return {
              name,
              kind: (s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other') as
                | 'file'
                | 'dir'
                | 'other',
              size: s.size,
            };
          } catch {
            return { name, kind: 'other' as const, size: 0 };
          }
        }),
      );
    },
  };
}

// ───────────────────────────── screenshot ────────────────────────────

function screenshotTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'screenshot',
      description:
        'Capture a screenshot of the host display via macOS `screencapture`. Returns the path on disk.',
      inputSchema: {
        type: 'object',
        properties: {
          outPath: { type: 'string', description: 'Optional output path; defaults to /tmp/.' },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ path: string }> {
      if (!enabled) {
        throw new Error('screenshot is disabled — set power.screenshot to true');
      }
      const p = (input ?? {}) as { outPath?: string };
      const out = p.outPath ?? join(tmpdir(), `mvpclaw-${Date.now()}.png`);
      execSync(`/usr/sbin/screencapture -x ${JSON.stringify(out)}`, { timeout: 10_000 });
      if (!existsSync(out)) {
        throw new Error(`screenshot: file not produced at ${out}`);
      }
      return Promise.resolve({ path: out });
    },
  };
}

// ───────────────────────────── claude_spawn ──────────────────────────

function claudeSpawnTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'claude_spawn',
      description:
        'Spawn the `claude` CLI with a one-shot prompt. Returns the raw text output. Use this to delegate a complex sub-task to a fresh Claude Code instance.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 8000 },
          timeoutMs: { type: 'integer', minimum: 5000, maximum: 600_000, default: 120_000 },
          cwd: { type: 'string', description: 'Working directory.' },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
      if (!enabled) {
        throw new Error('claude_spawn is disabled — set power.claudeSpawn to true');
      }
      const p = input as { prompt: string; timeoutMs?: number; cwd?: string };
      // Drop ANTHROPIC_API_KEY so the spawned claude falls back to the
      // host user's subscription auth (macOS keychain). The launchd plist
      // sets ANTHROPIC_API_KEY for OUR provider; the sub-agent should use
      // the host's subscription instead.
      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];
      delete env['ANTHROPIC_AUTH_TOKEN'];
      delete env['ANTHROPIC_BASE_URL'];
      const r = spawnSync('claude', ['--dangerously-skip-permissions', '-p', p.prompt], {
        cwd: p.cwd ?? homedir(),
        timeout: p.timeoutMs ?? 120_000,
        encoding: 'utf8',
        maxBuffer: 256 * 1024,
        env,
      });
      return Promise.resolve({
        exitCode: r.status,
        stdout: (r.stdout ?? '').slice(0, 64 * 1024),
        stderr: (r.stderr ?? '').slice(0, 8 * 1024),
      });
    },
  };
}

// ───────────────────────────── codex_spawn ───────────────────────────

function codexSpawnTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'codex_spawn',
      description: 'Spawn the `codex` CLI with a one-shot prompt. Returns the raw text output.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 8000 },
          timeoutMs: { type: 'integer', minimum: 5000, maximum: 600_000, default: 120_000 },
          cwd: { type: 'string' },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
      if (!enabled) {
        throw new Error('codex_spawn is disabled — set power.codexSpawn to true');
      }
      const p = input as { prompt: string; timeoutMs?: number; cwd?: string };
      const r = spawnSync('codex', ['--dangerously-bypass-approvals-and-sandbox', p.prompt], {
        cwd: p.cwd ?? homedir(),
        timeout: p.timeoutMs ?? 120_000,
        encoding: 'utf8',
        maxBuffer: 256 * 1024,
      });
      return Promise.resolve({
        exitCode: r.status,
        stdout: (r.stdout ?? '').slice(0, 64 * 1024),
        stderr: (r.stderr ?? '').slice(0, 8 * 1024),
      });
    },
  };
}

// ───────────────────────────── gemini_image ──────────────────────────

function geminiImageTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'gemini_image',
      description:
        'Generate an image via Gemini through OpenRouter (model google/gemini-2.5-flash-image). Returns the path of the saved PNG. Uses OPENROUTER_API_KEY.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 2000 },
          outPath: { type: 'string' },
        },
      },
      source: 'builtin',
      enabled,
    },
    async execute(input): Promise<{ path: string; bytes: number }> {
      if (!enabled) {
        throw new Error('gemini_image is disabled — set power.geminiImage to true');
      }
      const apiKey = process.env['OPENROUTER_API_KEY'];
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('gemini_image: OPENROUTER_API_KEY env var is unset');
      }
      const p = input as { prompt: string; outPath?: string };
      const out = p.outPath ?? join(tmpdir(), `mvpclaw-img-${Date.now()}.png`);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'mvpclaw',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-image',
          messages: [{ role: 'user', content: p.prompt }],
          modalities: ['image', 'text'],
        }),
      });
      if (!res.ok) {
        throw new Error(`gemini_image ${res.status}: ${await res.text().catch(() => '')}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{
          message?: { images?: Array<{ image_url?: { url?: string } }> };
        }>;
      };
      const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
      const m = url.match(/^data:image\/\w+;base64,(.+)$/);
      if (!m) {
        throw new Error('gemini_image: no image data url in response');
      }
      const buf = Buffer.from(m[1] ?? '', 'base64');
      const fs = await import('node:fs/promises');
      await fs.writeFile(out, buf);
      return { path: out, bytes: buf.length };
    },
  };
}

// ───────────────────────────── telegram_photo ────────────────────────

function telegramPhotoTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'telegram_photo',
      description:
        'Send a photo to a Telegram chat. Path must be an existing file on disk. Returns the Telegram message_id.',
      inputSchema: {
        type: 'object',
        required: ['chatId', 'path'],
        properties: {
          chatId: { type: 'string', description: 'External Telegram chat id.' },
          path: { type: 'string', description: 'Absolute path to the image file.' },
          caption: { type: 'string', maxLength: 1024 },
        },
      },
      source: 'builtin',
      enabled,
    },
    async execute(input): Promise<{ messageId: number; ok: boolean }> {
      if (!enabled) {
        throw new Error('telegram_photo is disabled — set power.telegramPhoto to true');
      }
      const token = process.env['TELEGRAM_BOT_TOKEN'];
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('telegram_photo: TELEGRAM_BOT_TOKEN unset');
      }
      const p = input as { chatId: string; path: string; caption?: string };
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(p.path);
      const form = new FormData();
      form.append('chat_id', p.chatId);
      if (p.caption) form.append('caption', p.caption);
      form.append('photo', new Blob([buf]), p.path.split('/').pop() ?? 'photo.png');
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!data.ok) {
        throw new Error(`telegram_photo: ${data.description ?? 'unknown error'}`);
      }
      return { ok: true, messageId: data.result?.message_id ?? 0 };
    },
  };
}
