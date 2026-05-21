/**
 * Built-in tools the agent can call without any external service.
 *
 * Five tools, all `source: 'builtin'`:
 *   - `mvpclaw_datetime`              — current UTC ISO 8601 + Unix epoch
 *   - `mvpclaw_status`                — provider, node version, key presence
 *   - `mvpclaw_read_recent_messages`  — recent messages in a chat
 *   - `mvpclaw_list_skills`           — names + descriptions of loaded skills
 *   - `mvpclaw_read_skill`            — full SKILL.md body for one skill
 *
 * `registerBuiltinTools(registry, deps)` wires them all. The factory takes
 * the runtime `deps` it needs (config + a getter for loaded skills) so the
 * tools are decoupled from any specific construction path.
 */
import { readFileSync } from 'node:fs';
import type { LoadedSkill } from '../agent/index.js';
import type { MvpClawConfigType } from '../config/index.js';
import { ChatsRepo, MessagesRepo, OutboxRepo, SessionsRepo } from '../db/index.js';
import type { ToolHandler } from './tool.js';
import type { ToolRegistry } from './tool-registry.js';

/** What the built-in factory needs from the rest of the app. */
export interface BuiltinToolDeps {
  /** Resolved config (for `mvpclaw_status`'s output). */
  config: MvpClawConfigType;
  /** A getter for currently-loaded skills (lazy so it tracks reloads). */
  getSkills(): readonly LoadedSkill[];
}

/**
 * Register every built-in tool on `registry`.
 *
 * @param registry - The registry instance.
 * @param deps - Runtime dependencies (config + skill getter).
 */
export function registerBuiltinTools(registry: ToolRegistry, deps: BuiltinToolDeps): void {
  registry.register(datetimeTool());
  registry.register(statusTool(deps.config));
  registry.register(readRecentMessagesTool());
  registry.register(listSkillsTool(deps.getSkills));
  registry.register(readSkillTool(deps.getSkills));
  registry.register(sendMessageTool(deps.config));
}

/**
 * `send_message` — reply on a LINKED channel of the current thread.
 *
 * In a single-thread bot the owner's Telegram + email are one conversation; this
 * lets the agent answer a Telegram turn by emailing (or vice versa). It can only
 * target channels linked to the active thread (the §6 safety guard), so the
 * agent can never send to an arbitrary address. Enqueues an outbox row; the
 * channel's `send()` delivers it. Registration is a no-op tool when no links
 * are configured.
 *
 * @param config - Resolved config (reads `links`).
 * @returns The tool handler.
 */
export function sendMessageTool(config: MvpClawConfigType): ToolHandler {
  return {
    definition: {
      name: 'send_message',
      description:
        'Reply on a LINKED channel of the current conversation (e.g. answer here by sending an email, or vice versa). `channel` must be a channel linked to this thread; arbitrary recipients are not allowed.',
      inputSchema: {
        type: 'object',
        required: ['channel', 'text'],
        properties: {
          channel: {
            type: 'string',
            description: 'Target channel linked to this thread (e.g. "email", "telegram").',
          },
          text: { type: 'string', minLength: 1 },
        },
      },
      source: 'builtin',
      enabled: config.links.length > 0,
    },
    async execute(
      input,
      execCtx,
    ): Promise<{ ok: boolean; channel: string; providerChatId: string }> {
      await Promise.resolve();
      if (config.links.length === 0) {
        throw new Error('send_message: no channel links are configured');
      }
      const p = input as { channel: string; text: string };
      const myChannel = execCtx.channel ?? '';
      const myId = execCtx.providerChatId ?? '';
      const group = config.links.find(
        (g) =>
          (g.primary.channel === myChannel && g.primary.id === myId) ||
          g.members.some((m) => m.channel === myChannel && m.id === myId),
      );
      if (!group) {
        throw new Error(
          `send_message: current chat (${myChannel}:${myId}) is not in any link group`,
        );
      }
      const target = group.members.find((m) => m.channel === p.channel);
      if (!target) {
        throw new Error(`send_message: channel "${p.channel}" is not linked to this thread`);
      }
      const chat = ChatsRepo.upsertChat(execCtx.db, {
        provider: target.channel,
        provider_chat_id: target.id,
        thread_id: null,
        type: 'private',
      });
      OutboxRepo.enqueueOutbox(execCtx.db, {
        chat_id: chat.id,
        run_id: execCtx.runId ?? null,
        provider: target.channel,
        provider_chat_id: target.id,
        provider_thread_id: null,
        kind: 'text',
        text: p.text,
      });
      return { ok: true, channel: target.channel, providerChatId: target.id };
    },
  };
}

// ─────────────────────────────── tools ───────────────────────────────

/** `mvpclaw_datetime` — current time in ISO 8601 + Unix epoch (no input). */
function datetimeTool(): ToolHandler {
  return {
    definition: {
      name: 'mvpclaw_datetime',
      description: 'Return the current date/time as ISO 8601 UTC and Unix epoch seconds.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: 'builtin',
      enabled: true,
    },
    execute(): Promise<{ iso: string; unix: number; tz: string }> {
      const now = new Date();
      return Promise.resolve({
        iso: now.toISOString(),
        unix: Math.floor(now.getTime() / 1000),
        tz: 'UTC',
      });
    },
  };
}

/** `mvpclaw_status` — configured provider + node version + key presence. */
function statusTool(config: MvpClawConfigType): ToolHandler {
  return {
    definition: {
      name: 'mvpclaw_status',
      description: 'Return the configured provider, Node version, and key presence (Yes/No).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: 'builtin',
      enabled: true,
    },
    execute(): Promise<{
      provider: string;
      node: string;
      telegramConfigured: 'Yes' | 'No';
      openrouterConfigured: 'Yes' | 'No';
    }> {
      return Promise.resolve({
        provider: config.agent.provider,
        node: process.versions.node,
        telegramConfigured: process.env[config.telegram.tokenEnv] ? 'Yes' : 'No',
        openrouterConfigured: process.env[config.openrouter.apiKeyEnv] ? 'Yes' : 'No',
      });
    },
  };
}

/** `mvpclaw_read_recent_messages` — most-recent N messages in `chat_id`. */
function readRecentMessagesTool(): ToolHandler {
  return {
    definition: {
      name: 'mvpclaw_read_recent_messages',
      description: "Read the most recent N messages in the active chat's session.",
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Internal chat id.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        },
        required: ['chat_id'],
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input, ctx): Promise<Array<{ direction: string; text: string; createdAt: string }>> {
      const params = input as { chat_id: string; limit?: number };
      const chat = ChatsRepo.findChatById(ctx.db, params.chat_id);
      if (!chat) {
        throw new Error(`mvpclaw_read_recent_messages: chat "${params.chat_id}" not found`);
      }
      const session = SessionsRepo.getOrCreateActiveSession(ctx.db, chat.id);
      const rows = MessagesRepo.recentMessages(ctx.db, session.id, params.limit ?? 20);
      return Promise.resolve(
        rows.map((r) => ({ direction: r.direction, text: r.text, createdAt: r.created_at })),
      );
    },
  };
}

/** `mvpclaw_list_skills` — names + descriptions of currently loaded skills. */
function listSkillsTool(getSkills: () => readonly LoadedSkill[]): ToolHandler {
  return {
    definition: {
      name: 'mvpclaw_list_skills',
      description: 'List enabled skills with their names and descriptions.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      source: 'builtin',
      enabled: true,
    },
    execute(): Promise<Array<{ name: string; description: string }>> {
      const rows = getSkills()
        .filter((s) => s.enabled)
        .map((s) => ({ name: s.name, description: s.description }));
      return Promise.resolve(rows);
    },
  };
}

/** `mvpclaw_read_skill` — full SKILL.md body for one skill by name. */
function readSkillTool(getSkills: () => readonly LoadedSkill[]): ToolHandler {
  return {
    definition: {
      name: 'mvpclaw_read_skill',
      description: 'Read the full SKILL.md body for one skill by name.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input): Promise<{ name: string; body: string }> {
      const params = input as { name: string };
      const skill = getSkills().find((s) => s.name === params.name);
      if (!skill) {
        throw new Error(`mvpclaw_read_skill: skill "${params.name}" not found`);
      }
      const body = readFileSync(skill.path, 'utf8');
      return Promise.resolve({ name: skill.name, body });
    },
  };
}
