/**
 * Sub-agent spawn power tools — `claude_spawn` and `codex_spawn`. Each shells
 * out to the respective CLI with a prompt and returns its raw output. Gated by
 * `power.claudeSpawn` / `power.codexSpawn`.
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import type { ToolHandler } from '../tool.js';

/**
 * Build the `claude_spawn` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function claudeSpawnTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'claude_spawn',
      description:
        'Spawn the `claude` CLI with a prompt. Returns the raw text output. ' +
        'Use this to delegate a complex sub-task to Claude Code (e.g. editing source, ' +
        'running pnpm check, committing, deploying). Default timeout is 5 minutes; ' +
        'pass `timeoutMs` up to 600000 (10 min) for longer tasks. ' +
        '\n\n' +
        '**For multi-step projects** (e.g. "build a game", "create + push + deploy a repo"): ' +
        'pick a stable `cwd` (e.g. `/tmp/mygame`) and pass `continueSession: true` on every ' +
        'call after the first. `--continue` makes claude resume the most-recent session in ' +
        'that cwd, so each spawn extends the same conversation — full code context, scratch ' +
        'state, and decisions persist across spawns. ALWAYS reuse the same cwd for a project; ' +
        'switching cwds starts a fresh session. Record the project cwd via memory_append so ' +
        'you can find it on later turns.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 8000 },
          timeoutMs: { type: 'integer', minimum: 5000, maximum: 600_000, default: 300_000 },
          cwd: {
            type: 'string',
            description: 'Working directory. Stable across calls for one project.',
          },
          continueSession: {
            type: 'boolean',
            description:
              'When true, passes `--continue` so the spawned claude resumes the latest ' +
              'session in `cwd`. Use on every call after the first within a multi-step ' +
              'project. Default false (fresh session).',
          },
        },
      },
      source: 'builtin',
      enabled,
    },
    execute(input): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
      if (!enabled) {
        throw new Error('claude_spawn is disabled — set power.claudeSpawn to true');
      }
      const p = input as {
        prompt: string;
        timeoutMs?: number;
        cwd?: string;
        continueSession?: boolean;
      };
      // Drop ANTHROPIC_API_KEY so the spawned claude falls back to the
      // host user's subscription auth (macOS keychain). The launchd plist
      // sets ANTHROPIC_API_KEY for OUR provider; the sub-agent should use
      // the host's subscription instead.
      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];
      delete env['ANTHROPIC_AUTH_TOKEN'];
      delete env['ANTHROPIC_BASE_URL'];
      const args = ['--dangerously-skip-permissions'];
      if (p.continueSession === true) {
        args.push('--continue');
      }
      args.push('-p', p.prompt);
      const r = spawnSync('claude', args, {
        cwd: p.cwd ?? homedir(),
        timeout: p.timeoutMs ?? 300_000,
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

/**
 * Build the `codex_spawn` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function codexSpawnTool(enabled: boolean): ToolHandler {
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
