#!/usr/bin/env node
/**
 * MVPClaw CLI entrypoint — P1 stub.
 *
 * Phase 1 only ships the typechecking + config-loading + logger skeleton.
 * Ticket #C1 (Phase 1.3) replaces this stub with the full citty-driven
 * dispatcher and the 15-command surface.
 *
 * For now this entrypoint:
 *   1. Loads the config (proves the loader works end-to-end).
 *   2. Creates the logger.
 *   3. Prints a single status line to stdout and exits 0.
 */
import { loadConfig } from '../config/index.js';
import { makeLogger } from '../logging/index.js';

function main(): void {
  const config = loadConfig();
  const log = makeLogger(config.logging);
  log.info({ phase: 'P1' }, 'mvpclaw skeleton loaded');
  // stdout = data; this is the only stdout write in this stub.
  process.stdout.write(
    JSON.stringify({
      ok: true,
      phase: 'P1',
      provider: config.agent.provider,
      note: 'CLI surface stubbed; ticket C1 replaces this entrypoint with the citty dispatcher.',
    }) + '\n',
  );
}

main();
