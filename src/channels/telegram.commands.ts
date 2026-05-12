/**
 * Slash-command parser for inbound chat text.
 *
 * Pure function: takes a message body, returns the parsed command + args
 * or `null` if the text isn't a slash command. Lives in the Telegram
 * area because Telegram's `/command@botname args…` syntax is what set
 * the shape — but the parser knows nothing about grammY and is reused
 * by the CLI-injection channel too.
 *
 * The orchestrator (lands in P4) is responsible for DISPATCHING the
 * parsed command. This module only RECOGNISES.
 */

/** A parsed slash-command. */
export interface ParsedCommand {
  /** Command name without the leading slash and without `@botname`. Lowercase. */
  command: string;
  /** Optional bot mention (`@MyBot`) if the user qualified the command. Lowercase, no `@`. */
  botMention?: string | undefined;
  /** Everything after the command and whitespace, verbatim (trailing whitespace trimmed). */
  args: string;
}

/**
 * Built-in command names the router knows how to handle. Skill invocations
 * (e.g. `/research foo`) also pass through `parseSlashCommand` but are
 * routed via the skills layer rather than this list.
 */
export const BUILTIN_COMMANDS = ['start', 'help', 'status', 'new', 'skills'] as const;
export type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number];

/** Telegram bot-username pattern. Used to recognize `/command@BotName`. */
const SLASH_RE = /^\/([a-zA-Z][a-zA-Z0-9_]*)(?:@([a-zA-Z][a-zA-Z0-9_]*))?(?:\s+(.*))?$/s;

/**
 * Parse a message body for a leading slash command.
 *
 * Recognises:
 *   /start
 *   /help arg1 arg2
 *   /status\@MyBot
 *   /research what is X
 *
 * Returns `null` if the body doesn't start with `/<letter>...` or the
 * command name contains characters outside `[a-zA-Z0-9_]`.
 *
 * @param text - The raw message body.
 * @returns Parsed `{command, botMention, args}` or `null` when not a command.
 */
export function parseSlashCommand(text: string): ParsedCommand | null {
  if (typeof text !== 'string' || text.length === 0 || text[0] !== '/') {
    return null;
  }
  const match = SLASH_RE.exec(text);
  if (!match) {
    return null;
  }
  const command = (match[1] ?? '').toLowerCase();
  const botMention = match[2] !== undefined ? match[2].toLowerCase() : undefined;
  const args = (match[3] ?? '').trim();
  return botMention === undefined ? { command, args } : { command, botMention, args };
}

/**
 * Is this command name one of the built-in commands the router recognises?
 *
 * @param command - The command name (without leading slash).
 * @returns `true` if `command` is in `BUILTIN_COMMANDS`.
 */
export function isBuiltinCommand(command: string): command is BuiltinCommand {
  return (BUILTIN_COMMANDS as readonly string[]).includes(command);
}
