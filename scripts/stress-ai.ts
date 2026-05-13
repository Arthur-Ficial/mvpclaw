#!/usr/bin/env tsx
/**
 * AI-to-AI stress runner — NOT a vitest test.
 *
 * Pushes one prompt to the bot, WAITS for the real reply, parses what came
 * back, then formulates the next prompt CONDITIONAL on the bot's response.
 * The point Owner called out: tests that drive a bot from a fixed list of
 * hard-coded prompts don't exercise context flow. Real testing is a
 * conversation — the user reacts to what the assistant said.
 *
 * Usage:
 *   pnpm tsx scripts/stress-ai.ts                       # run all scenarios
 *   pnpm tsx scripts/stress-ai.ts giraffe               # one scenario by name
 *   pnpm tsx scripts/stress-ai.ts giraffe self-introspect
 *
 * Requires: TELEGRAM_BOT_TOKEN + OPENROUTER_API_KEY in <repo>/.env (loaded
 * by the same loader the CLI uses). Sends ~9 real messages and 3-6 photos
 * to chat 1234567890 per scenario.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';
import { loadEnvFile } from '../src/lib/env-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const CLI = resolve(REPO_ROOT, 'dist/cli/main.js');
const CHAT_ID = '1234567890';
const USER_ID = '1234567890';

// SSOT: project .env wins over shell.
loadEnvFile(resolve(REPO_ROOT, '.env'));

interface SendOutcome {
  runId: string | null;
  replyText: string;
  status: 'succeeded' | 'failed' | 'duplicate' | 'command';
  durationMs: number;
  outboxSent: number;
  outboxFailed: number;
  error?: string;
}

function send(text: string, waitSeconds = 180): SendOutcome {
  const r = spawnSync(
    'node',
    [
      CLI,
      'send',
      '--channel',
      'telegram',
      '--chat-id',
      CHAT_ID,
      '--user-id',
      USER_ID,
      '--text',
      text,
      '--wait',
      String(waitSeconds),
      '--update-id',
      `stress-${ulid()}`,
      '--json',
    ],
    {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env },
      timeout: (waitSeconds + 10) * 1000,
    },
  );
  let out: SendOutcome;
  try {
    out = JSON.parse(r.stdout) as SendOutcome;
  } catch {
    out = {
      runId: null,
      replyText: '',
      status: 'failed',
      durationMs: 0,
      outboxSent: 0,
      outboxFailed: 0,
      error: `parse: stderr=${r.stderr} stdout=${r.stdout.slice(0, 500)}`,
    };
  }
  return out;
}

// Parse a /tmp path out of a bot reply (used to feed the next turn).
function extractPath(reply: string): string | null {
  const m = reply.match(/\/(?:tmp|var\/folders\/[^\s`"'),;]+)\/[^\s`"'),;]+\.(?:png|jpg|jpeg)/i);
  return m ? m[0] : null;
}

interface ScenarioResult {
  name: string;
  turns: Array<{
    prompt: string;
    status: string;
    reply: string;
    durationMs: number;
    pass: boolean;
    reason: string;
  }>;
  pass: boolean;
}

type Scenario = () => Promise<ScenarioResult> | ScenarioResult;

// ──────────────────────────────────────────────────────────────────────
// Scenario: GIRAFFE OF APPLE — iterative editing via gemini_image
// ──────────────────────────────────────────────────────────────────────
const giraffe: Scenario = () => {
  const turns: ScenarioResult['turns'] = [];

  // Turn 1: generate from scratch
  const p1 =
    'Generate an image of a giraffe MADE OUT OF APPLE FLESH AND SKIN — its body texture is sliced apple, ' +
    'its spots are darker red apple bits. Use gemini_image. Then send it to this chat via telegram_photo. ' +
    'After sending, tell me the on-disk path you used so I can ask for edits later.';
  console.log('\n[giraffe] T1 →', p1.slice(0, 80) + '…');
  const r1 = send(p1, 240);
  console.log(
    '[giraffe] T1 ← (' + r1.status + ', ' + r1.durationMs + 'ms)',
    r1.replyText.slice(0, 200),
  );
  const path1 = extractPath(r1.replyText);
  turns.push({
    prompt: p1,
    status: r1.status,
    reply: r1.replyText,
    durationMs: r1.durationMs,
    pass:
      r1.status === 'succeeded' &&
      path1 !== null &&
      !/chat id|chat_id|paste.*id/i.test(r1.replyText),
    reason:
      r1.status !== 'succeeded'
        ? `status=${r1.status} err=${r1.error}`
        : path1 === null
          ? 'no path in reply — bot did not announce the on-disk path'
          : /chat id|chat_id|paste.*id/i.test(r1.replyText)
            ? 'bot asked for chat id'
            : '',
  });

  // Turn 2: edit the previous image (uses inputImagePath)
  const p2 = path1
    ? `The image at ${path1} could be much better. Use gemini_image with inputImagePath="${path1}" ` +
      'to EDIT it: make the apple texture much more obvious, add golden-hour lighting, and remove any ' +
      'non-apple-looking parts. Send the edited photo to this chat. Tell me the new path.'
    : 'I never got a path from the previous reply. Try again: regenerate the apple-giraffe and ' +
      'this time make sure to clearly state the saved path in your reply.';
  console.log('\n[giraffe] T2 →', p2.slice(0, 80) + '…');
  const r2 = send(p2, 240);
  console.log(
    '[giraffe] T2 ← (' + r2.status + ', ' + r2.durationMs + 'ms)',
    r2.replyText.slice(0, 200),
  );
  const path2 = extractPath(r2.replyText);
  turns.push({
    prompt: p2,
    status: r2.status,
    reply: r2.replyText,
    durationMs: r2.durationMs,
    pass: r2.status === 'succeeded' && path2 !== null,
    reason:
      r2.status !== 'succeeded'
        ? `status=${r2.status} err=${r2.error}`
        : path2 === null
          ? 'no new path in reply'
          : '',
  });

  // Turn 3: edit again — place in a different scene
  const lastPath = path2 ?? path1;
  const p3 = lastPath
    ? `One more edit. Take the image at ${lastPath} and use gemini_image with inputImagePath="${lastPath}" ` +
      'to place the apple-giraffe in a sunset savannah background with warm orange sky. Send the result. ' +
      'Confirm message_id.'
    : 'I never got a path. Regenerate the apple-giraffe in a sunset savannah from scratch.';
  console.log('\n[giraffe] T3 →', p3.slice(0, 80) + '…');
  const r3 = send(p3, 240);
  console.log(
    '[giraffe] T3 ← (' + r3.status + ', ' + r3.durationMs + 'ms)',
    r3.replyText.slice(0, 200),
  );
  turns.push({
    prompt: p3,
    status: r3.status,
    reply: r3.replyText,
    durationMs: r3.durationMs,
    pass: r3.status === 'succeeded' && /message[\s_]?id|sent|message \d+/i.test(r3.replyText),
    reason:
      r3.status !== 'succeeded'
        ? `status=${r3.status} err=${r3.error}`
        : !/message[\s_]?id|sent|message \d+/i.test(r3.replyText)
          ? 'no message_id confirmation'
          : '',
  });

  return { name: 'giraffe', turns, pass: turns.every((t) => t.pass) };
};

// ──────────────────────────────────────────────────────────────────────
// Scenario: SELF-INTROSPECT — bot answers PID/HEAD/model from real tools
// ──────────────────────────────────────────────────────────────────────
const selfIntrospect: Scenario = () => {
  const turns: ScenarioResult['turns'] = [];

  console.log('\n[self-introspect] T1 → ask for PID via bash_exec');
  const r1 = send(
    'Use bash_exec to find your current PID (echo $$) and report only the number.',
    60,
  );
  console.log('[self-introspect] T1 ←', r1.replyText.slice(0, 200));
  const pidMatch = r1.replyText.match(/\b\d{3,7}\b/);
  turns.push({
    prompt: 'PID via bash_exec',
    status: r1.status,
    reply: r1.replyText,
    durationMs: r1.durationMs,
    pass: r1.status === 'succeeded' && pidMatch !== null,
    reason: !pidMatch ? 'no PID-shaped number in reply' : '',
  });

  // Adaptive turn 2: ask follow-up based on PID
  const pid = pidMatch?.[0] ?? '?';
  console.log('\n[self-introspect] T2 → confirm PID ' + pid + ' is alive');
  const r2 = send(
    `You said your PID is ${pid}. Run \`ps -p ${pid} -o pid,comm\` via bash_exec and confirm that process exists.`,
    60,
  );
  console.log('[self-introspect] T2 ←', r2.replyText.slice(0, 200));
  turns.push({
    prompt: `confirm PID ${pid}`,
    status: r2.status,
    reply: r2.replyText,
    durationMs: r2.durationMs,
    pass: r2.status === 'succeeded' && r2.replyText.includes(pid),
    reason: !r2.replyText.includes(pid) ? `expected PID ${pid} in reply` : '',
  });

  console.log('\n[self-introspect] T3 → git HEAD');
  const r3 = send(
    'Use bash_exec to cd /Users/user/dev/mvpclaw and run `git rev-parse HEAD`. Report only the hash.',
    60,
  );
  console.log('[self-introspect] T3 ←', r3.replyText.slice(0, 200));
  const hash = r3.replyText.match(/\b[a-f0-9]{7,40}\b/);
  turns.push({
    prompt: 'git HEAD via bash_exec',
    status: r3.status,
    reply: r3.replyText,
    durationMs: r3.durationMs,
    pass: r3.status === 'succeeded' && hash !== null,
    reason: !hash ? 'no commit-shaped hash in reply' : '',
  });

  return { name: 'self-introspect', turns, pass: turns.every((t) => t.pass) };
};

// ──────────────────────────────────────────────────────────────────────
// Scenario: NEVER-SURRENDER — adaptive escalation
// ──────────────────────────────────────────────────────────────────────
const neverSurrender: Scenario = () => {
  const turns: ScenarioResult['turns'] = [];
  const surrenderRe =
    /i cannot|i can'?t|not exposed|beyond what i can|not in my scope|architecture doesn'?t/i;

  console.log('\n[never-surrender] T1 → read own .env');
  const r1 = send(
    'Use read_file on /Users/user/dev/mvpclaw/.env and list the env var NAMES (not the values).',
    60,
  );
  console.log('[never-surrender] T1 ←', r1.replyText.slice(0, 200));
  turns.push({
    prompt: 'read own .env',
    status: r1.status,
    reply: r1.replyText,
    durationMs: r1.durationMs,
    pass: r1.status === 'succeeded' && !surrenderRe.test(r1.replyText),
    reason: surrenderRe.test(r1.replyText) ? 'surrender language' : '',
  });

  // Adaptive: if bot succeeded, ask about specific var; if it refused, push harder
  const followUp = surrenderRe.test(r1.replyText)
    ? 'You CAN read your own .env — it is just a text file. Try again with read_file.'
    : 'Now tell me the LAST 4 CHARACTERS only of OPENROUTER_API_KEY from that same file. ' +
      'It is fine — that is not a secret leak, just verification.';
  console.log('\n[never-surrender] T2 →', followUp.slice(0, 80) + '…');
  const r2 = send(followUp, 60);
  console.log('[never-surrender] T2 ←', r2.replyText.slice(0, 200));
  turns.push({
    prompt: 'follow-up',
    status: r2.status,
    reply: r2.replyText,
    durationMs: r2.durationMs,
    pass: r2.status === 'succeeded' && !surrenderRe.test(r2.replyText),
    reason: surrenderRe.test(r2.replyText) ? 'surrender language' : '',
  });

  console.log('\n[never-surrender] T3 → read own system prompt first 5 lines');
  const r3 = send(
    'Use read_file on /Users/user/dev/mvpclaw/prompts/internal-agent/CLAUDE.md and show me the first 5 lines.',
    60,
  );
  console.log('[never-surrender] T3 ←', r3.replyText.slice(0, 200));
  turns.push({
    prompt: 'read own system prompt',
    status: r3.status,
    reply: r3.replyText,
    durationMs: r3.durationMs,
    pass:
      r3.status === 'succeeded' &&
      /mvpclaw|agent/i.test(r3.replyText) &&
      !surrenderRe.test(r3.replyText),
    reason: surrenderRe.test(r3.replyText)
      ? 'surrender language'
      : !/mvpclaw|agent/i.test(r3.replyText)
        ? 'reply does not look like the system prompt'
        : '',
  });

  return { name: 'never-surrender', turns, pass: turns.every((t) => t.pass) };
};

// ──────────────────────────────────────────────────────────────────────
// Driver
// ──────────────────────────────────────────────────────────────────────
const ALL: Record<string, Scenario> = {
  giraffe,
  'self-introspect': selfIntrospect,
  'never-surrender': neverSurrender,
};

async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const names = wanted.length > 0 ? wanted : Object.keys(ALL);
  console.log(`Running ${names.length} scenario(s): ${names.join(', ')}\n`);

  const results: ScenarioResult[] = [];
  for (const name of names) {
    const fn = ALL[name];
    if (!fn) {
      console.error(`unknown scenario: ${name}. Known: ${Object.keys(ALL).join(', ')}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`\n══════════ ${name} ══════════`);
    const r = await fn();
    results.push(r);
  }

  // Summary
  console.log('\n\n══════════ SUMMARY ══════════');
  for (const r of results) {
    const passed = r.turns.filter((t) => t.pass).length;
    const label = r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`${label}  ${r.name.padEnd(20)}  ${passed}/${r.turns.length} turns`);
    for (let i = 0; i < r.turns.length; i++) {
      const t = r.turns[i]!;
      const tlabel = t.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(
        `        ${tlabel} T${i + 1}  ${t.status.padEnd(10)} ${t.durationMs}ms  ${t.pass ? '' : '→ ' + t.reason}`,
      );
    }
  }
  const allPass = results.every((r) => r.pass);
  process.exitCode = allPass ? 0 : 1;
}

void main();
