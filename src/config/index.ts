/**
 * Config area — Zod schema + env-substituting loader for the SSOT
 * `mvpclaw.config.json` file. The schema is the contract; any field not
 * declared here is rejected at load time.
 */
export { MvpClawConfig, ProactiveConfig, IdleConfig } from './config.schema.js';
export type {
  MvpClawConfig as MvpClawConfigType,
  AgentProviderName,
  TelegramConfig,
  AgentConfig,
  ClaudeCliConfig,
  OpenRouterConfig,
  AnthropicConfig,
  GeminiConfig,
  McpConfig,
  SkillsConfig,
  LoggingConfig,
} from './config.schema.js';
export { loadConfig, resolveConfigPath, substituteEnv } from './load-config.js';
