/**
 * `screenshot` power tool — capture the host display via macOS
 * `screencapture`. Gated by `power.screenshot`.
 *
 * Uses `spawnSync` (no shell) so the output path can never be interpreted as
 * a shell command.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolHandler } from '../tool.js';

/**
 * Build the `screenshot` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function screenshotTool(enabled: boolean): ToolHandler {
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
      const r = spawnSync('/usr/sbin/screencapture', ['-x', out], { timeout: 10_000 });
      if (r.status !== 0 || !existsSync(out)) {
        throw new Error(`screenshot: file not produced at ${out}`);
      }
      return Promise.resolve({ path: out });
    },
  };
}
