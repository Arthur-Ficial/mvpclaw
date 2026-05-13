/**
 * Real-Telegram harness — shells out to `mvpclaw send --channel telegram`
 * so every assertion exercises the EXACT path a production update follows:
 *
 *   CLI → router → orchestrator → real OpenRouter → outbox → grammY → Bot API
 *
 * Why a subprocess instead of in-process: the CLI is the user-facing contract
 * (the "killer command"). If it works from the shell, the bot works in
 * production. Each spawn pays ~200ms of Node startup — negligible against the
 * 1-5s LLM call.
 *
 * Opt-in gate: `MVPCLAW_REAL_TELEGRAM=1` AND `TELEGRAM_BOT_TOKEN` AND
 * `MVPCLAW_TEST_CHAT_ID` (defaults to the chat id seeded in `data/mvpclaw.sqlite`).
 * `pnpm check` never triggers this — only `pnpm test:real-telegram`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid } from 'ulid';

const REPO_ROOT = resolve(__dirname, '../../..');
export const CLI = resolve(REPO_ROOT, 'dist/cli/main.js');

// Load the project's .env BEFORE any skip-gate check so vitest sees the
// project's TELEGRAM_BOT_TOKEN and OPENROUTER_API_KEY. Mirrors the loader at
// `src/cli/load-env.ts` — project .env wins over shell env.
(function loadProjectEnv(): void {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) {
      continue;
    }
    const eq = t.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
})();

/** The single test chat the harness sends to. Override with MVPCLAW_TEST_CHAT_ID. */
export const TEST_CHAT_ID = process.env['MVPCLAW_TEST_CHAT_ID'] ?? '1234567890';
export const TEST_USER_ID = process.env['MVPCLAW_TEST_USER_ID'] ?? TEST_CHAT_ID;

/** Skip the entire suite unless explicitly opted in. */
export const realTelegramSkip =
  process.env['MVPCLAW_REAL_TELEGRAM'] !== '1' ||
  (process.env['TELEGRAM_BOT_TOKEN'] ?? '').length === 0 ||
  !existsSync(CLI);

/** Outcome shape from `mvpclaw send --json` — mirrors `SendOutcome` in src/app/send-message.ts. */
export interface SendOutcome {
  runId: string | null;
  chatId: string;
  channel: string;
  providerChatId: string;
  providerUpdateId: string;
  replyText: string;
  tracePath: string | null;
  status: 'succeeded' | 'failed' | 'duplicate' | 'command';
  durationMs: number;
  outboxSent: number;
  outboxFailed: number;
  error?: string;
}

/**
 * Inject one synthetic inbound through the telegram channel and wait for the
 * bot's real reply to actually leave grammY via `bot.api.sendMessage`.
 *
 * @param text - The message body the bot sees as its incoming user prompt.
 * @param opts - Optional overrides for chat / user / wait window / extra args.
 * @returns Parsed `SendOutcome` JSON from the CLI's stdout.
 */
export function injectViaTelegram(
  text: string,
  opts: { chatId?: string; userId?: string; waitSeconds?: number; updateId?: string } = {},
): SendOutcome {
  const wait = String(opts.waitSeconds ?? 90);
  const chatId = opts.chatId ?? TEST_CHAT_ID;
  const userId = opts.userId ?? TEST_USER_ID;
  const updateId = opts.updateId ?? `harness-${ulid()}`;
  const r = spawnSync(
    'node',
    [
      CLI,
      'send',
      '--channel',
      'telegram',
      '--chat-id',
      chatId,
      '--user-id',
      userId,
      '--text',
      text,
      '--wait',
      wait,
      '--update-id',
      updateId,
      '--json',
    ],
    {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: (Number(wait) + 10) * 1000,
    },
  );
  if (r.status !== 0) {
    // The CLI reports failure as `status:'failed'` in JSON on stdout with
    // exit code 3; non-3 exits indicate a real crash (usage/config error).
    let parsed: SendOutcome | null = null;
    try {
      parsed = JSON.parse(r.stdout) as SendOutcome;
    } catch {
      // fall through
    }
    if (parsed && parsed.status === 'failed') {
      return parsed;
    }
    throw new Error(
      `mvpclaw send crashed: exit=${r.status ?? 'null'} stderr=${r.stderr} stdout=${r.stdout}`,
    );
  }
  return JSON.parse(r.stdout) as SendOutcome;
}

/** A subset of the outbox row shape the harness asserts against. */
export interface OutboxRow {
  id: string;
  chat_id: string;
  run_id: string | null;
  provider: string;
  kind: string;
  status: string;
  attempts: number;
  provider_message_id: string | null;
  text_len: number;
  text: string;
}

/** Read all outbox rows tied to a given run_id, in insertion order. */
export function readOutboxForRun(runId: string): OutboxRow[] {
  return dbQuery<OutboxRow>(
    `SELECT id, chat_id, run_id, provider, kind, status, attempts, provider_message_id, length(text) AS text_len, text FROM outbox WHERE run_id = '${runId}' ORDER BY created_at ASC`,
  );
}

/** A subset of the tool_calls row shape the harness asserts against. */
export interface ToolCallRow {
  tool_name: string;
  source: string;
  input_len: number;
  result_len: number;
  error: string | null;
}

/** Read tool_calls for a given run_id, ordered by start time. */
export function readToolCallsForRun(runId: string): ToolCallRow[] {
  return dbQuery<ToolCallRow>(
    `SELECT tool_name, source, length(input_json) AS input_len, COALESCE(length(result_json), 0) AS result_len, error FROM tool_calls WHERE run_id = '${runId}' ORDER BY started_at ASC`,
  );
}

/** Outcome of a direct `mvpclaw tool call` invocation. */
export interface ToolCallOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Whether the tool was rejected as not-registered / config-disabled. */
  isDisabled: boolean;
}

/**
 * Invoke `mvpclaw tool call <name> --args <json>` directly. Used to test
 * individual tools without going through the model.
 */
export function callTool(name: string, args: Record<string, unknown>): ToolCallOutcome {
  const r = spawnSync(
    'node',
    [CLI, 'tool', 'call', name, '--input', JSON.stringify(args), '--json'],
    { encoding: 'utf8', cwd: REPO_ROOT, env: { ...process.env }, timeout: 180_000 },
  );
  return {
    exitCode: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    isDisabled: /not registered|disabled|unknown tool/i.test(r.stderr + r.stdout),
  };
}

/** Run an arbitrary read-only SQL query and parse the JSON array result. */
function dbQuery<T>(sql: string): T[] {
  const r = spawnSync('node', [CLI, 'db', 'query', sql, '--json'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env },
    timeout: 10_000,
  });
  if (r.status !== 0) {
    throw new Error(`mvpclaw db query failed: exit=${r.status} stderr=${r.stderr}`);
  }
  return JSON.parse(r.stdout) as T[];
}
