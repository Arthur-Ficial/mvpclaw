/**
 * CLI area — the project's first-class, Unix-style command surface.
 *
 * Entry: `src/cli/main.ts` (citty dispatcher). Each top-level sub-command
 * lives in `src/cli/cmd/<name>.cmd.ts`. Universal output discipline is in
 * `src/cli/output.ts`; canonical exit codes are in `src/cli/exit.ts`.
 *
 * The CLI is MVPClaw's primary interface — every agent capability is
 * reachable via a sub-command. Telegram is one channel among N; the AI can
 * drive the system without it. See `CLAUDE.md` §"CLI-first / AI-steerable".
 */
export { resolveOutputContext, writeOut, writeJsonLine, writeProgress } from './output.js';
export type { OutputContext } from './output.js';
export { exitUsage, exitConfig, exitRuntime, exitNotFound, exitTimeout } from './exit.js';
