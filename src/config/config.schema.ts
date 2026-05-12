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
  provider: AgentProviderName.default('claude-cli'),
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
  defaultModel: z.string().min(1).default('meta-llama/llama-3.2-3b-instruct:free'),
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

/** Skills loader config. */
export const SkillsConfig = z.object({
  enabled: z.boolean().default(true),
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
  logging: LoggingConfig.default({} as never),
});
export type MvpClawConfig = z.infer<typeof MvpClawConfig>;
