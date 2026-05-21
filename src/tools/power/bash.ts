/**
 * `bash_exec` power tool — run a shell command on the host. DANGEROUS: it can
 * read/write anything the host user can. Output is truncated to keep tool
 * results bounded.
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import type { ToolHandler } from '../tool.js';

/**
 * Build the `bash_exec` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function bashExecTool(enabled: boolean): ToolHandler {
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
