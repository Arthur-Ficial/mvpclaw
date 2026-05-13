/**
 * `mvpclaw memory` — human/AI surface for agent self-memory.
 *
 * show / append / clear / grep / archive. `clear` is destructive and
 * requires `--yes`.
 */
import { defineCommand } from 'citty';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ChatMemoryRepo } from '../../db/index.js';
import { nowIso } from '../../lib/index.js';
import { redactString } from '../../logging/index.js';
import { MEMORY_LIMITS } from '../../memory/index.js';
import { exitNotFound, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { withAppContext } from '../with-context.js';
import { commonArgs } from './_common.js';

const runtimePath = (): string =>
  resolve(homedir(), '.mvpclaw', 'workspaces', 'default', 'CLAUDE.local.md');

function readRuntime(): string {
  const path = runtimePath();
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function requireChatScope(args: Record<string, unknown>): string {
  if (args['scope'] !== 'chat') {
    exitUsage('--scope must be runtime or chat');
  }
  if (typeof args['chat-id'] !== 'string') {
    exitUsage('--chat-id is required when --scope=chat');
  }
  return args['chat-id'] as string;
}

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show memory contents.' },
  args: {
    ...commonArgs,
    scope: { type: 'string', description: 'runtime | chat', required: true },
    'chat-id': { type: 'string', description: 'Required when scope=chat.', required: false },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    await withAppContext(args, (built) => {
      if (args.scope === 'runtime') {
        writeOut({ scope: 'runtime', path: runtimePath(), body: readRuntime() }, ctx);
        return;
      }
      const chatId = requireChatScope(args);
      writeOut(
        { scope: 'chat', chatId, body: ChatMemoryRepo.readChatMemory(built.ctx.db, chatId) },
        ctx,
      );
    });
  },
});

const appendCmd = defineCommand({
  meta: { name: 'append', description: 'Append a dated entry to memory. Append-only, redacted.' },
  args: {
    ...commonArgs,
    scope: { type: 'string', required: true },
    'chat-id': { type: 'string', required: false },
    text: { type: 'string', required: true },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    await withAppContext(args, (built) => {
      const text = String(args.text);
      if (text.length > MEMORY_LIMITS.maxAppendChars) {
        exitUsage(`--text exceeds ${MEMORY_LIMITS.maxAppendChars} chars (got ${text.length})`);
      }
      const safe = redactString(text, built.ctx.config.logging.redact);
      const entry = `## ${nowIso()}\n${safe}\n\n`;
      if (args.scope === 'runtime') {
        writeFileSync(runtimePath(), readRuntime() + entry, 'utf8');
        writeOut(
          { ok: true, scope: 'runtime', appendedBytes: Buffer.byteLength(entry, 'utf8') },
          ctx,
        );
        return;
      }
      const chatId = requireChatScope(args);
      ChatMemoryRepo.appendChatMemory(built.ctx.db, chatId, entry);
      writeOut({ ok: true, scope: 'chat', appendedBytes: Buffer.byteLength(entry, 'utf8') }, ctx);
    });
  },
});

const clearCmd = defineCommand({
  meta: { name: 'clear', description: 'Wipe memory (destructive; --yes required).' },
  args: {
    ...commonArgs,
    scope: { type: 'string', required: true },
    'chat-id': { type: 'string', required: false },
    yes: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    if (!args.yes) {
      exitUsage('clear is destructive; pass --yes to confirm');
    }
    await withAppContext(args, (built) => {
      if (args.scope === 'runtime') {
        writeFileSync(runtimePath(), '', 'utf8');
        writeOut({ ok: true, scope: 'runtime' }, ctx);
        return;
      }
      const chatId = requireChatScope(args);
      ChatMemoryRepo.setChatMemory(built.ctx.db, chatId, '');
      writeOut({ ok: true, scope: 'chat', chatId }, ctx);
    });
  },
});

const grepCmd = defineCommand({
  meta: { name: 'grep', description: 'Case-insensitive regex search across memory.' },
  args: {
    ...commonArgs,
    scope: { type: 'string', required: true },
    'chat-id': { type: 'string', required: false },
    pattern: { type: 'positional', required: true },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    await withAppContext(args, (built) => {
      let body = '';
      if (args.scope === 'runtime') {
        body = readRuntime();
      } else if (args.scope === 'chat' && typeof args['chat-id'] === 'string') {
        body = ChatMemoryRepo.readChatMemory(built.ctx.db, args['chat-id']);
      } else {
        exitUsage('--scope chat requires --chat-id');
      }
      const re = new RegExp(String(args.pattern), 'i');
      const matches = body
        .split('\n')
        .map((line, i) => ({ line, lineNumber: i + 1 }))
        .filter((x) => re.test(x.line));
      writeOut({ scope: String(args.scope), matchCount: matches.length, matches }, ctx);
    });
  },
});

const archiveCmd = defineCommand({
  meta: { name: 'archive', description: 'list archive (chat-scoped only).' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', required: true },
    limit: { type: 'string', default: '20' },
  },
  async run({ args }) {
    const ctx = resolveOutputContext(args);
    await withAppContext(args, (built) => {
      const rows = ChatMemoryRepo.listArchive(
        built.ctx.db,
        String(args['chat-id']),
        Number(args.limit),
      );
      if (rows.length === 0 && !existsSync(`${runtimePath()}.archive-`)) {
        exitNotFound('no archive entries for this chat');
      }
      writeOut(rows, ctx);
    });
  },
});

export const memoryCmd = defineCommand({
  meta: { name: 'memory', description: 'show / append / clear / grep / archive memory.' },
  args: { ...commonArgs },
  subCommands: {
    show: showCmd,
    append: appendCmd,
    clear: clearCmd,
    grep: grepCmd,
    archive: archiveCmd,
  },
});
