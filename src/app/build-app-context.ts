/**
 * `buildAppContext` — the single factory that turns a loaded config + the
 * process env into a fully wired `AppContext`.
 *
 * Used by every CLI sub-command that needs to actually do something with
 * the agent: `mvpclaw send`, `mvpclaw agent run`, `mvpclaw start`, etc.
 *
 * What gets wired:
 *   - Logger (Pino → stderr, redaction list from config)
 *   - SQLite (opened at the config's database.url, migrations applied)
 *   - Channels: always `cli-inject`; `telegram` when token env is set
 *   - Providers: `openrouter` when its key env is set; (P5 wires claude-cli)
 *   - Traces directory: `<dataDir>/traces`
 *
 * The function is synchronous (no async work) so callers can build a
 * context and then use it from anywhere — no awaited setup races.
 */
import { resolve } from 'node:path';
import {
  createOpenRouterProvider,
  type AgentProviderAdapter,
  type LoadedSkill,
} from '../agent/index.js';
import {
  createCliInjectChannel,
  createTelegramChannel,
  type ChannelAdapter,
  type CliInjectChannel,
  type TelegramChannelAdapter,
} from '../channels/index.js';
import type { MvpClawConfigType } from '../config/index.js';
import { applyMigrations, openDb, pathFromUrl } from '../db/index.js';
import { makeLogger } from '../logging/index.js';
import { loadSkillsFromDir, syncSkillsToWorkspace } from '../skills/index.js';
import { createToolRegistry, registerBuiltinTools, registerExternalTools } from '../tools/index.js';
import type { AppContext } from './app-context.js';

/** The fully-wired context plus the cli-inject channel exposed for tests/CLI. */
export interface BuiltAppContext {
  ctx: AppContext;
  /** Direct handle to the cli-inject channel (for pushing synthetic messages). */
  cliInject: CliInjectChannel;
  /** Telegram channel if wired (token env set), otherwise null. */
  telegram: TelegramChannelAdapter | null;
}

/**
 * Build a wired `AppContext` from a resolved config.
 *
 * @param config - The loaded `mvpclaw.config.json` (after env substitution).
 * @param env - The process env (defaults to `process.env`); used to read
 *              channel + provider API keys by name from the config.
 * @returns A `BuiltAppContext` ready for use.
 */
export function buildAppContext(
  config: MvpClawConfigType,
  env: NodeJS.ProcessEnv = process.env,
): BuiltAppContext {
  const log = makeLogger(config.logging);

  // SQLite: open + migrate (idempotent).
  const dbPath = pathFromUrl(config.database.url);
  const db = openDb(dbPath);
  const migrationsDir = resolve(process.cwd(), 'migrations');
  applyMigrations(db, migrationsDir);

  // Channels: always wire cli-inject; wire telegram only when token present.
  const cliInject = createCliInjectChannel();
  const channels: Record<string, ChannelAdapter> = { 'cli-inject': cliInject };

  let telegram: TelegramChannelAdapter | null = null;
  const tgToken = env[config.telegram.tokenEnv];
  if (config.telegram.enabled && typeof tgToken === 'string' && tgToken.length > 0) {
    telegram = createTelegramChannel(config.telegram, env);
    channels['telegram'] = telegram;
  }

  // Providers: wire openrouter when key present. P5 wires claude-cli.
  const providers: Record<string, AgentProviderAdapter> = {};
  const orKey = env[config.openrouter.apiKeyEnv];
  if (config.openrouter.enabled && typeof orKey === 'string' && orKey.length > 0) {
    providers['openrouter'] = createOpenRouterProvider({
      apiKey: orKey,
      baseUrl: config.openrouter.baseUrl,
      model: config.openrouter.defaultModel,
      title: 'mvpclaw',
    });
  }

  const tracesDir = resolve(process.cwd(), config.app.dataDir, 'traces');

  // Skills: scan the configured directory, validate frontmatter, upsert into
  // the `skills` table. Sync the SKILL.md files into the Claude workspace
  // so Claude CLI discovers them via its standard mechanism.
  let skills: readonly LoadedSkill[] = [];
  if (config.skills.enabled) {
    const loaded = loadSkillsFromDir(resolve(process.cwd(), config.skills.skillsDir), db);
    skills = loaded.skills;
    if (loaded.errors.length > 0) {
      for (const e of loaded.errors) {
        log.warn({ skillPath: e.path, reason: e.reason }, 'skill-loader: validation error');
      }
    }
    syncSkillsToWorkspace(
      resolve(process.cwd(), config.skills.skillsDir),
      config.skills.runtimeClaudeSkillsDir,
    );
  }

  // Tools: build the registry and register both built-ins and the optional
  // external tools (Anthropic, Gemini). External tools register as disabled
  // when their key env vars are missing.
  const tools = createToolRegistry();
  registerBuiltinTools(tools, { config, getSkills: () => skills });
  registerExternalTools(tools, config, env);

  const ctx: AppContext = {
    config,
    log,
    db,
    channels,
    providers,
    tracesDir,
    tools,
    skills,
  };

  return { ctx, cliInject, telegram };
}
