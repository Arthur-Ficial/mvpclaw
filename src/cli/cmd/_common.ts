/**
 * Shared scaffolding for every CLI sub-command.
 *
 * Citty does not propagate args from a parent command into its children, so
 * the universal flags (`--json`, `--quiet`, `--verbose`, `--config`) live
 * here and are spread into every sub-command's `args` block.
 *
 * Sub-commands that are not yet implemented (Phase 1.3 ships them all as
 * stubs) call `notYetImplemented(name)` which writes a structured stderr
 * message and exits with code 3 (runtime — "not implemented" is a runtime
 * failure from the user's point of view).
 */
import type { ArgsDef } from 'citty';
import { exitRuntime } from '../exit.js';

/**
 * Universal flags every sub-command accepts.
 *
 * The flat object is spread into a sub-command's `args` field so citty
 * recognises them at the sub-command level.
 */
export const commonArgs = {
  json: {
    type: 'boolean' as const,
    description: 'Emit JSON to stdout (auto-on when stdout is not a TTY).',
    default: false,
  },
  quiet: {
    type: 'boolean' as const,
    description: 'Suppress non-error stdout output.',
    default: false,
  },
  verbose: {
    type: 'boolean' as const,
    description: 'Emit structured progress to stderr.',
    default: false,
  },
  config: {
    type: 'string' as const,
    description:
      'Path to mvpclaw.config.json. Defaults to MVPCLAW_CONFIG env or ./mvpclaw.config.json.',
    required: false,
  },
} satisfies ArgsDef;

/**
 * Standard handler for a sub-command that exists in the surface but is not
 * yet implemented. Writes a clear stderr message naming the ticket that
 * delivers the feature, then exits 3.
 *
 * @param subcommand - The sub-command name (e.g. "send", "outbox").
 * @param ticket - The ticket that delivers this sub-command (e.g. "C4 / #28").
 */
export function notYetImplemented(subcommand: string, ticket: string): never {
  exitRuntime(
    `'${subcommand}' is not yet implemented (delivered by ticket ${ticket}). ` +
      `Phase 1.3 ships the surface as stubs; later phases fill them in.`,
  );
}
