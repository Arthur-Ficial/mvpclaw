/**
 * `screenshot` power tool — capture the host display. Cross-platform: macOS
 * uses `screencapture`; Linux tries the common CLIs (`gnome-screenshot`,
 * `scrot`, `import`, `grim`) and uses the first one installed. Gated by
 * `power.screenshot`. Uses `spawnSync` (no shell) so the output path can never
 * be interpreted as a shell command.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolHandler } from '../tool.js';

/** Is `bin` on PATH? (no-shell `which`). */
function onPath(bin: string): boolean {
  return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0;
}

/**
 * Resolve the screenshot command for the host OS + output path.
 *
 * @param out - Output PNG path.
 * @returns `{ cmd, args }`, or null when no supported tool is available.
 */
function screenshotCommand(out: string): { cmd: string; args: string[] } | null {
  if (process.platform === 'darwin') {
    return { cmd: '/usr/sbin/screencapture', args: ['-x', out] };
  }
  // Linux (X11 / Wayland) — first installed tool wins.
  if (onPath('gnome-screenshot')) {
    return { cmd: 'gnome-screenshot', args: ['-f', out] };
  }
  if (onPath('scrot')) {
    return { cmd: 'scrot', args: [out] };
  }
  if (onPath('import')) {
    return { cmd: 'import', args: ['-window', 'root', out] };
  }
  if (onPath('grim')) {
    return { cmd: 'grim', args: [out] };
  }
  return null;
}

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
      const command = screenshotCommand(out);
      if (!command) {
        throw new Error(
          'screenshot: no screenshot tool found. On Linux install one of: ' +
            'gnome-screenshot, scrot, imagemagick (import), or grim (Wayland).',
        );
      }
      const r = spawnSync(command.cmd, command.args, { timeout: 10_000 });
      if (r.status !== 0 || !existsSync(out)) {
        throw new Error(`screenshot: file not produced at ${out}`);
      }
      return Promise.resolve({ path: out });
    },
  };
}
