/**
 * Telegram media power tools — `telegram_photo` and `telegram_video`. Each
 * uploads a file on disk to a Telegram chat via the Bot API. Gated by
 * `power.telegramPhoto` / `power.telegramVideo`. Needs `TELEGRAM_BOT_TOKEN`.
 *
 * When invoked during an agent turn, `chatId` defaults to the current chat;
 * when invoked via `mvpclaw tool call`, it is required.
 */
import { existsSync } from 'node:fs';
import type { ToolHandler } from '../tool.js';

/**
 * Build the `telegram_photo` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function telegramPhotoTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'telegram_photo',
      description:
        'Send a photo to a Telegram chat. Path must be an existing file on disk. ' +
        'When invoked by the agent during a chat turn, `chatId` defaults to the current ' +
        "chat — omit it to send to whoever you're talking to. Returns the Telegram message_id.",
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          chatId: {
            type: 'string',
            description:
              'External Telegram chat id. Optional when called from an agent turn ' +
              '(falls back to the current chat). REQUIRED when called via `mvpclaw tool call`.',
          },
          path: { type: 'string', description: 'Absolute path to the image file.' },
          caption: { type: 'string', maxLength: 1024 },
        },
      },
      source: 'builtin',
      enabled,
    },
    async execute(input, execCtx): Promise<{ messageId: number; ok: boolean }> {
      if (!enabled) {
        throw new Error('telegram_photo is disabled — set power.telegramPhoto to true');
      }
      const token = process.env['TELEGRAM_BOT_TOKEN'];
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('telegram_photo: TELEGRAM_BOT_TOKEN unset');
      }
      const p = input as { chatId?: string; path: string; caption?: string };
      const chatId = p.chatId ?? execCtx.providerChatId;
      if (typeof chatId !== 'string' || chatId.length === 0) {
        throw new Error(
          'telegram_photo: no chatId given and no current chat context — ' +
            'pass `chatId` explicitly when invoking outside an agent turn',
        );
      }
      const ext = p.path.toLowerCase().split('.').pop() ?? '';
      if (ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'mkv') {
        throw new Error(
          `telegram_photo: ".${ext}" is a video — use telegram_video instead. ` +
            '/sendPhoto rejects video payloads with PHOTO_INVALID_DIMENSIONS.',
        );
      }
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(p.path);
      const form = new FormData();
      form.append('chat_id', chatId);
      if (p.caption) {
        form.append('caption', p.caption);
      }
      form.append('photo', new Blob([buf]), p.path.split('/').pop() ?? 'photo.png');
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!data.ok) {
        throw new Error(`telegram_photo: ${data.description ?? 'unknown error'}`);
      }
      return { ok: true, messageId: data.result?.message_id ?? 0 };
    },
  };
}

/**
 * Build the `telegram_video` tool handler.
 *
 * @param enabled - Whether the tool is active (gated by power config).
 * @returns The tool handler.
 */
export function telegramVideoTool(enabled: boolean): ToolHandler {
  return {
    definition: {
      name: 'telegram_video',
      description:
        'Send a video (MP4 or WebM) to a Telegram chat. Path must be an existing file on disk. ' +
        'When invoked by the agent during a chat turn, `chatId` defaults to the current ' +
        "chat — omit it to send to whoever you're talking to. Returns the Telegram message_id. " +
        'Telegram caps uploads at ~50 MB per file.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          chatId: {
            type: 'string',
            description:
              'External Telegram chat id. Optional when called from an agent turn ' +
              '(falls back to the current chat). REQUIRED when called via `mvpclaw tool call`.',
          },
          path: {
            type: 'string',
            description: 'Absolute path to an .mp4 or .webm video file.',
          },
          caption: { type: 'string', maxLength: 1024 },
          width: { type: 'integer', minimum: 1 },
          height: { type: 'integer', minimum: 1 },
          duration: { type: 'integer', minimum: 1, description: 'Duration in seconds.' },
          supportsStreaming: {
            type: 'boolean',
            description: 'Hint Telegram the video is suitable for streaming.',
          },
        },
      },
      source: 'builtin',
      enabled,
    },
    async execute(input, execCtx): Promise<{ messageId: number; ok: boolean }> {
      if (!enabled) {
        throw new Error(
          'telegram_video is disabled — set power.enabled and power.telegramVideo to true',
        );
      }
      const token = process.env['TELEGRAM_BOT_TOKEN'];
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('telegram_video: TELEGRAM_BOT_TOKEN unset');
      }
      const p = input as {
        chatId?: string;
        path: string;
        caption?: string;
        width?: number;
        height?: number;
        duration?: number;
        supportsStreaming?: boolean;
      };
      const chatId = p.chatId ?? execCtx.providerChatId;
      if (typeof chatId !== 'string' || chatId.length === 0) {
        throw new Error(
          'telegram_video: no chatId given and no current chat context — ' +
            'pass `chatId` explicitly when invoking outside an agent turn',
        );
      }
      const ext = p.path.toLowerCase().split('.').pop() ?? '';
      if (ext !== 'mp4' && ext !== 'webm') {
        throw new Error(
          `telegram_video: file must be .mp4 or .webm (got ".${ext}") — Telegram sendVideo accepts MP4/WebM only`,
        );
      }
      if (!existsSync(p.path)) {
        throw new Error(`telegram_video: file not found at ${p.path}`);
      }
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(p.path);
      const form = new FormData();
      form.append('chat_id', chatId);
      if (p.caption) {
        form.append('caption', p.caption);
      }
      if (typeof p.width === 'number') {
        form.append('width', String(p.width));
      }
      if (typeof p.height === 'number') {
        form.append('height', String(p.height));
      }
      if (typeof p.duration === 'number') {
        form.append('duration', String(p.duration));
      }
      if (p.supportsStreaming === true) {
        form.append('supports_streaming', 'true');
      }
      form.append('video', new Blob([buf]), p.path.split('/').pop() ?? `video.${ext}`);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!data.ok) {
        throw new Error(`telegram_video: ${data.description ?? 'unknown error'}`);
      }
      return { ok: true, messageId: data.result?.message_id ?? 0 };
    },
  };
}
