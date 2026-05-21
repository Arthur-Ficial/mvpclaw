/**
 * Zod schema for the SSOT `mvpclaw.config.json` file.
 *
 * One config file describes the whole runtime. Secrets are referenced by env-var
 * name only (e.g. `tokenEnv: "TELEGRAM_BOT_TOKEN"`) — never stored inline.
 *
 * The schema is the contract: any field not declared here is rejected at load
 * time, and any missing required field fails validation with a clear path.
 */
import { z } from 'zod';

/** Provider name used by the agent layer. */
export const AgentProviderName = z.enum(['claude-cli', 'openrouter']);
export type AgentProviderName = z.infer<typeof AgentProviderName>;

/** Telegram-specific config block. */
export const TelegramConfig = z.object({
  enabled: z.boolean().default(true),
  tokenEnv: z.string().min(1).default('TELEGRAM_BOT_TOKEN'),
  mode: z.enum(['polling', 'webhook']).default('polling'),
  allowedChatIds: z.array(z.string()).default([]),
  allowedUserIds: z.array(z.string()).default([]),
  replyMode: z
    .enum(['dm-only', 'dm-and-mentioned-groups', 'all'])
    .default('dm-and-mentioned-groups'),
  streaming: z
    .object({
      enabled: z.boolean().default(true),
      editIntervalMs: z.number().int().positive().default(1200),
      maxMessageChars: z.number().int().positive().default(3900),
    })
    .default({ enabled: true, editIntervalMs: 1200, maxMessageChars: 3900 }),
});
export type TelegramConfig = z.infer<typeof TelegramConfig>;

/** Agent provider config block (which provider, timeouts, history caps). */
export const AgentConfig = z.object({
  provider: AgentProviderName.default('openrouter'),
  timeoutMs: z.number().int().positive().default(180_000),
  maxHistoryMessages: z.number().int().nonnegative().default(20),
  maxToolRounds: z.number().int().positive().default(8),
  systemPromptFile: z.string().default('./prompts/internal-agent/CLAUDE.md'),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

/** Claude CLI bridge config. */
export const ClaudeCliConfig = z.object({
  command: z.string().min(1).default('claude'),
  useOpenRouter: z.boolean().default(true),
  outputFormat: z.enum(['stream-json', 'json', 'text']).default('stream-json'),
  allowedTools: z.array(z.string()).default(['Read', 'mcp__mvpclaw-tools__*']),
  env: z.record(z.string()).default({
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: '${OPENROUTER_API_KEY}',
    ANTHROPIC_API_KEY: '',
  }),
});
export type ClaudeCliConfig = z.infer<typeof ClaudeCliConfig>;

/** OpenRouter direct provider config. */
export const OpenRouterConfig = z.object({
  enabled: z.boolean().default(true),
  apiKeyEnv: z.string().default('OPENROUTER_API_KEY'),
  baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
  defaultModel: z.string().min(1).default('deepseek/deepseek-v4-flash'),
  enableServerTools: z.boolean().default(false),
  serverTools: z
    .array(
      z.object({
        type: z.string().min(1),
        parameters: z.record(z.unknown()).optional(),
      }),
    )
    .default([]),
});
export type OpenRouterConfig = z.infer<typeof OpenRouterConfig>;

/** Optional Anthropic SDK config (web-search tool). */
export const AnthropicConfig = z.object({
  enabled: z.boolean().default(false),
  apiKeyEnv: z.string().default('ANTHROPIC_API_KEY'),
  webSearch: z
    .object({
      enabled: z.boolean().default(false),
      maxUses: z.number().int().positive().default(5),
    })
    .default({ enabled: false, maxUses: 5 }),
});
export type AnthropicConfig = z.infer<typeof AnthropicConfig>;

/** Optional Gemini SDK config (research tool). */
export const GeminiConfig = z.object({
  enabled: z.boolean().default(false),
  apiKeyEnv: z.string().default('GEMINI_API_KEY'),
  model: z.string().default('gemini-2.5-flash'),
  tools: z
    .object({
      googleSearch: z.boolean().default(false),
      urlContext: z.boolean().default(false),
    })
    .default({ googleSearch: false, urlContext: false }),
});
export type GeminiConfig = z.infer<typeof GeminiConfig>;

/** MCP servers (consumed + exposed). */
export const McpConfig = z.object({
  enabled: z.boolean().default(true),
  servers: z.record(z.unknown()).default({}),
  expose: z
    .object({
      toolsServer: z.boolean().default(true),
      conversationsServer: z.boolean().default(true),
    })
    .default({ toolsServer: true, conversationsServer: true }),
});
export type McpConfig = z.infer<typeof McpConfig>;

/**
 * Power-tools config — DANGEROUS by default per maintainer directive.
 *
 * Each flag gates one tool. `enabled: false` flips the entire suite off
 * regardless of individual flags.
 */
export const PowerConfig = z.object({
  enabled: z.boolean().default(true),
  bashExec: z.boolean().default(true),
  readFs: z.boolean().default(true),
  screenshot: z.boolean().default(true),
  claudeSpawn: z.boolean().default(true),
  codexSpawn: z.boolean().default(true),
  geminiImage: z.boolean().default(true),
  telegramPhoto: z.boolean().default(true),
  telegramVideo: z.boolean().default(true),
});
export type PowerConfig = z.infer<typeof PowerConfig>;

/** Proactive-send policy (spec §33). */
export const ProactiveConfig = z.object({
  /** Quiet-hours window in 24h `HH:mm` form (inclusive start, exclusive end). */
  quietHours: z
    .object({
      start: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .default('22:00'),
      end: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .default('08:00'),
    })
    .default({ start: '22:00', end: '08:00' }),
  /** Maximum proactive sends per chat per local-day. */
  maxPerChatPerDay: z.number().int().nonnegative().default(6),
  /** Minimum seconds between two proactive sends to the same chat. */
  minGapSeconds: z.number().int().nonnegative().default(900),
});
export type ProactiveConfig = z.infer<typeof ProactiveConfig>;

/** Idle / sliding-window config (spec §27). */
export const IdleConfig = z.object({
  /** Maximum messages kept in the sliding window before truncation. */
  windowMessages: z.number().int().positive().default(40),
  /** Maximum token budget for the sliding window (approx, char/4). */
  windowTokens: z.number().int().positive().default(24_000),
  /** Seconds of chat inactivity after which the next inbound auto-resets. */
  autoResetAfterSeconds: z.number().int().nonnegative().default(0),
});
export type IdleConfig = z.infer<typeof IdleConfig>;

/**
 * Skills loader config.
 *
 * `enabled`/`disabled` are the SSOT for which skills load. Per-skill `enabled:`
 * frontmatter is only the default; an entry here overrides it. Precedence:
 * `disabled` wins over everything; otherwise if `enabled` is non-empty it acts
 * as an allowlist; otherwise the frontmatter default applies. `loadAll: false`
 * is the master switch that skips the loader entirely.
 */
export const SkillsConfig = z.object({
  loadAll: z.boolean().default(true),
  enabled: z.array(z.string()).default([]),
  disabled: z.array(z.string()).default([]),
  skillsDir: z.string().default('./skills'),
  runtimeClaudeSkillsDir: z.string().default('~/.mvpclaw/workspaces/default/.claude/skills'),
});
export type SkillsConfig = z.infer<typeof SkillsConfig>;

/** Logging config (level + redact list). */
export const LoggingConfig = z.object({
  level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  redact: z
    .array(z.string())
    .default(['TELEGRAM_BOT_TOKEN', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']),
});
export type LoggingConfig = z.infer<typeof LoggingConfig>;

/**
 * Deploy-skill defaults. The `github-deploy` / `vercel-deploy` skills read
 * these; no secrets live here (auth is the host `gh`/`vercel` CLI's concern).
 */
export const DeploysConfig = z.object({
  github: z
    .object({
      enabled: z.boolean().default(true),
      defaultVisibility: z.enum(['private', 'public']).default('private'),
    })
    .default({ enabled: true, defaultVisibility: 'private' }),
  vercel: z
    .object({
      enabled: z.boolean().default(true),
      defaultTarget: z.enum(['preview', 'production']).default('preview'),
      scope: z.string().default(''),
    })
    .default({ enabled: true, defaultTarget: 'preview', scope: '' }),
});
export type DeploysConfig = z.infer<typeof DeploysConfig>;

/**
 * Email config — both the on-demand skill and the unattended channel.
 *
 * The `channel` block (disabled by default) turns email into a polled
 * `ChannelAdapter` (IMAP via himalaya) so new mail flows into the bot like
 * Telegram. The top-level fields configure the on-demand skill. No secrets
 * here; himalaya owns its own credential store.
 */
export const EmailConfig = z.object({
  enabled: z.boolean().default(false),
  himalayaAccount: z.string().default(''),
  defaultPageSize: z.number().int().positive().default(10),
  channel: z
    .object({
      enabled: z.boolean().default(false),
      account: z.string().default(''),
      ownAddress: z.string().default(''),
      pollIntervalSec: z.number().int().positive().default(120),
    })
    .default({ enabled: false, account: '', ownAddress: '', pollIntervalSec: 120 }),
});
export type EmailConfig = z.infer<typeof EmailConfig>;

/** One channel identity in a link group: channel name + external id/address. */
export const ChatRefSchema = z.object({
  channel: z.string().min(1),
  id: z.string().min(1),
});

/**
 * A channel-link group — ties several identities into one shared session via
 * its `primary` chat. Default config ships none; the owner adds a group linking
 * their Telegram chat + email address to get a single cross-channel thread.
 */
export const LinkGroupSchema = z.object({
  id: z.string().min(1),
  primary: ChatRefSchema,
  members: z.array(ChatRefSchema).min(1),
});
export type LinkGroup = z.infer<typeof LinkGroupSchema>;

/** The top-level config schema. */
export const MvpClawConfig = z.object({
  app: z
    .object({
      name: z.string().default('mvpclaw'),
      dataDir: z.string().default('./data'),
      workspaceDir: z.string().default('./workspace'),
      defaultTimezone: z.string().default('Europe/Vienna'),
    })
    .default({
      name: 'mvpclaw',
      dataDir: './data',
      workspaceDir: './workspace',
      defaultTimezone: 'Europe/Vienna',
    }),
  database: z
    .object({
      url: z.string().default('file:./data/mvpclaw.sqlite'),
    })
    .default({ url: 'file:./data/mvpclaw.sqlite' }),
  telegram: TelegramConfig.default({} as never),
  agent: AgentConfig.default({} as never),
  claudeCli: ClaudeCliConfig.default({} as never),
  openrouter: OpenRouterConfig.default({} as never),
  anthropic: AnthropicConfig.default({} as never),
  gemini: GeminiConfig.default({} as never),
  mcp: McpConfig.default({} as never),
  skills: SkillsConfig.default({} as never),
  deploys: DeploysConfig.default({} as never),
  email: EmailConfig.default({} as never),
  links: z.array(LinkGroupSchema).default([]),
  proactive: ProactiveConfig.default({} as never),
  idle: IdleConfig.default({} as never),
  power: PowerConfig.default({} as never),
  logging: LoggingConfig.default({} as never),
});
export type MvpClawConfig = z.infer<typeof MvpClawConfig>;
