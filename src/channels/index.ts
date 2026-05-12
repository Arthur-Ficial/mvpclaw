/**
 * Channels area — pluggable chat surfaces.
 *
 * Every channel (Telegram, the CLI-injection channel, future Discord/Slack
 * /voice) implements the `ChannelAdapter` interface from `./channel.ts`.
 * The router, orchestrator, and outbox import only from this area; no
 * channel-specific SDK leaks past the boundary.
 *
 * Telegram lives in `./telegram.channel.ts` (added in P3, #9). The
 * CLI-injection channel — used by `mvpclaw send` — lives in
 * `./cli-inject.channel.ts`. It is real, not fake — same envelope, same
 * pipeline, same side-effects; only the inbound source differs.
 */
export type {
  ChannelAdapter,
  Direction,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from './channel.js';
export { createCliInjectChannel } from './cli-inject.channel.js';
export type { CliInjectChannel } from './cli-inject.channel.js';
export { createTelegramChannel } from './telegram.channel.js';
export type { TelegramChannelAdapter } from './telegram.channel.js';
export { chunkText } from './telegram.format.js';
export { parseSlashCommand, isBuiltinCommand, BUILTIN_COMMANDS } from './telegram.commands.js';
export type { ParsedCommand, BuiltinCommand } from './telegram.commands.js';
