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
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { ChatMemoryRepo } from '../../db/index.js';
import { redactString } from '../../logging/index.js';
import { MEMORY_LIMITS } from '../../memory/index.js';
import { exitConfig, exitNotFound, exitUsage } from '../exit.js';
import { resolveOutputContext, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

function open(args: Record<string, unknown>): ReturnType<typeof buildAppContext> {
  try {
    const config = loadConfig(typeof args['config'] === 'string' ? args['config'] : undefined);
    return buildAppContext(config);
  } catch (err) {
    exitConfig(err instanceof Error ? err.message : String(err));
  }
}

const runtimePath = (): string =>
  resolve(homedir(), '.mvpclaw', 'workspaces', 'default', 'CLAUDE.local.md');

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show memory contents.' },
  args: {
    ...commonArgs,
    scope: { type: 'string', description: 'runtime | chat', required: true },
    'chat-id': { type: 'string', description: 'Required when scope=chat.', required: false },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      if (args.scope === 'runtime') {
        const path = runtimePath();
        const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
        writeOut({ scope: 'runtime', path, body }, ctx);
        return;
      }
      if (args.scope !== 'chat') {
        exitUsage('--scope must be runtime or chat');
      }
      if (typeof args['chat-id'] !== 'string') {
        exitUsage('--chat-id is required when --scope=chat');
      }
      writeOut(
        {
          scope: 'chat',
          chatId: args['chat-id'],
          body: ChatMemoryRepo.readChatMemory(built.ctx.db, args['chat-id']),
        },
        ctx,
      );
    } finally {
      built.ctx.db.close();
    }
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
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const text = String(args.text);
      if (text.length > MEMORY_LIMITS.maxAppendChars) {
        exitUsage(`--text exceeds ${MEMORY_LIMITS.maxAppendChars} chars (got ${text.length})`);
      }
      const safe = redactString(text, built.ctx.config.logging.redact);
      const entry = `## ${new Date().toISOString()}\n${safe}\n\n`;
      if (args.scope === 'runtime') {
        const path = runtimePath();
        const prev = existsSync(path) ? readFileSync(path, 'utf8') : '';
        writeFileSync(path, prev + entry, 'utf8');
        writeOut(
          { ok: true, scope: 'runtime', appendedBytes: Buffer.byteLength(entry, 'utf8') },
          ctx,
        );
        return;
      }
      if (args.scope !== 'chat') {
        exitUsage('--scope must be runtime or chat');
      }
      if (typeof args['chat-id'] !== 'string') {
        exitUsage('--chat-id is required when --scope=chat');
      }
      ChatMemoryRepo.appendChatMemory(built.ctx.db, args['chat-id'], entry);
      writeOut({ ok: true, scope: 'chat', appendedBytes: Buffer.byteLength(entry, 'utf8') }, ctx);
    } finally {
      built.ctx.db.close();
    }
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
  run({ args }) {
    const ctx = resolveOutputContext(args);
    if (!args.yes) {
      exitUsage('clear is destructive; pass --yes to confirm');
    }
    const built = open(args);
    try {
      if (args.scope === 'runtime') {
        writeFileSync(runtimePath(), '', 'utf8');
        writeOut({ ok: true, scope: 'runtime' }, ctx);
        return;
      }
      if (args.scope !== 'chat') {
        exitUsage('--scope must be runtime or chat');
      }
      if (typeof args['chat-id'] !== 'string') {
        exitUsage('--chat-id is required when --scope=chat');
      }
      ChatMemoryRepo.setChatMemory(built.ctx.db, args['chat-id'], '');
      writeOut({ ok: true, scope: 'chat', chatId: args['chat-id'] }, ctx);
    } finally {
      built.ctx.db.close();
    }
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
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      let body = '';
      if (args.scope === 'runtime') {
        body = existsSync(runtimePath()) ? readFileSync(runtimePath(), 'utf8') : '';
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
    } finally {
      built.ctx.db.close();
    }
  },
});

const archiveCmd = defineCommand({
  meta: { name: 'archive', description: 'list archive (chat-scoped only).' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', required: true },
    limit: { type: 'string', default: '20' },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const rows = ChatMemoryRepo.listArchive(
        built.ctx.db,
        String(args['chat-id']),
        Number(args.limit),
      );
      if (rows.length === 0 && !existsSync(`${runtimePath()}.archive-`)) {
        exitNotFound('no archive entries for this chat');
      }
      writeOut(rows, ctx);
    } finally {
      built.ctx.db.close();
    }
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
