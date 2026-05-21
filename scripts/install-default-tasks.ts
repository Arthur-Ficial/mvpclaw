#!/usr/bin/env tsx
/**
 * `install-default-tasks.ts` — idempotently install the two recurring
 * tasks that ship by default:
 *
 *   1. **email-check-30min** — every 30 minutes, scan unread email,
 *      apply learned `feedback` memory rules when present, ask Owner on
 *      Telegram (3/day cap) when no rule applies, otherwise create
 *      `todo_add` rows and mark email as read.
 *
 *   2. **example-project-daily-vet** — every morning at 08:00 Europe/Vienna,
 *      spawn Claude Code inside `~/dev/example-project`, VET every open GitHub
 *      issue per the project's CLAUDE.md process, take maximum allowed
 *      action up to draft PR, and post a verdict table to Owner. A
 *      `RELEASE PROPOSAL` block triggers the hard-gate handshake — the
 *      spawned agent NEVER runs release/deploy commands without an
 *      explicit `release: approved <version>` reply from Owner.
 *
 * The script keys idempotency off the first line of each prompt: a
 * `# task-marker: <name>` header. If a non-terminal task with that
 * marker already exists for the target chat, we skip.
 *
 * Run with: `pnpm tsx scripts/install-default-tasks.ts`
 */
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/index.js';
import { applyMigrations, ChatsRepo, TasksRepo, openDb, pathFromUrl } from '../src/db/index.js';
import { parseCron } from '../src/scheduler/recurrence.js';

const FRANZ_PROVIDER_CHAT_ID = '1234567890';
const FRANZ_PROVIDER = 'telegram';

interface DefaultTaskSpec {
  marker: string;
  kind: 'recurring';
  cron: string;
  timezone: string;
  prompt: string;
}

const TASKS: readonly DefaultTaskSpec[] = [
  {
    marker: 'email-check-30min',
    kind: 'recurring',
    cron: '*/30 * * * *',
    timezone: 'Europe/Vienna',
    prompt: [
      '# task-marker: email-check-30min',
      '',
      'You are firing as a scheduled task. Goal: process unread email.',
      '',
      'Step 1: `memory_list` and scan for any `feedback` rules whose description matches "email" or sender patterns you might encounter. Keep that list in mind.',
      'Step 2: Invoke the `email` skill with the equivalent of `himalaya envelope list "flag:unseen"`. For each unread:',
      '  a. Read sender, subject, first 200 chars of body.',
      '  b. Does a `feedback` memory apply? `memory_get <slug>` to confirm. If yes, apply the stored rule (archive, draft reply, todo), mark the email read, continue to the next email. DO NOT ask Owner.',
      '  c. If no rule applies AND the sender is EXTERNAL (not @example.com): send Owner ONE Telegram message: "📧 Email from <sender> re <subject>. What to do?" Then STOP this run — wait for his next message. Do not mark the email as read.',
      '  d. If no rule applies AND the sender is INTERNAL (@example.com): create a TODO via `todo_add` ("[email] reply to <sender> re <subject>", source="email") and mark the email read.',
      'Step 3: When Owner answers the question from (c) in a later turn, save his decision as a `memory_save` of type "feedback" keyed on the sender/subject pattern (slug like "email-from-acme-billing"). Then the next firing of THIS task will apply that rule automatically.',
      '',
      'Throttle: you may post AT MOST 3 ask-Owner messages per day across all firings (the proactive policy enforces this). If throttled, create a TODO instead of asking.',
      '',
      'Silence is the success signal — if there is nothing unread, produce no output and finish.',
    ].join('\n'),
  },
  {
    marker: 'example-project-daily-vet',
    kind: 'recurring',
    cron: '0 8 * * *',
    timezone: 'Europe/Vienna',
    prompt: [
      '# task-marker: example-project-daily-vet',
      '',
      'You are firing as the morning example-project triage routine.',
      '',
      'Step 1: `claude_spawn` with cwd="/Users/user/dev/example-project" and continueSession=true. Prompt the spawned Claude Code with:',
      '',
      '"""',
      'Read /Users/user/dev/example-project/CLAUDE.md sections "MVPClaw Daily Triage Gate" and "Handling GitHub Issues" — that is your contract. Then `gh issue list --state open --repo Arthur-Ficial/example-project --json number,title,labels,createdAt,body`. For each issue, VET against the 5-step process (alignment, reproducibility, TDD-first, golden-goal-alignment, release-gate). Take the maximum allowed action up to and including: comment, label, close-as-noise, OPEN A DRAFT PR WITH TESTS. Do NOT under any circumstance run release commands (`make release`, `gh release create`, `git tag v*`, `make publish`, `brew bump-formula-pr`, or any push to main). At the end, emit a markdown table with columns: number | title | action-taken | next-step. If any issue is release-worthy, emit a separate `RELEASE PROPOSAL` block at the end with version + changelog.',
      '"""',
      '',
      'Step 2: Receive the markdown table. Post it verbatim to the Telegram chat via the normal reply path.',
      'Step 3: If a `RELEASE PROPOSAL` block is present, post it as a SEPARATE Telegram message starting with the literal string `RELEASE PROPOSAL`. Then STOP this run — do nothing further. Owner replies with `release: approved <version>` or `release: rejected`; the next firing of this task picks up his decision.',
      'Step 4: For every "proceed" verdict in the table, call `todo_add` with source="example-project" so the work survives the daemon restarting.',
    ].join('\n'),
  },
] as const;

function main(): void {
  const cfg = loadConfig();
  const dbPath = pathFromUrl(cfg.database.url);
  const db = openDb(resolve(process.cwd(), dbPath));
  applyMigrations(db, resolve(process.cwd(), 'migrations'));

  const chat = ChatsRepo.upsertChat(db, {
    provider: FRANZ_PROVIDER,
    provider_chat_id: FRANZ_PROVIDER_CHAT_ID,
    type: 'private',
  });

  const existing = TasksRepo.listTasks(db, { chat_id: chat.id, limit: 200 });

  let installed = 0;
  let skipped = 0;
  for (const spec of TASKS) {
    const conflict = existing.find(
      (t) =>
        t.prompt.startsWith(`# task-marker: ${spec.marker}`) &&
        (t.state === 'scheduled' || t.state === 'running' || t.state === 'paused'),
    );
    if (conflict) {
      console.log(
        `skip ${spec.marker} — already present as task ${conflict.id} (${conflict.state})`,
      );
      skipped++;
      continue;
    }
    const next = parseCron(spec.cron, spec.timezone);
    if (!next.ok) {
      throw new Error(`bad cron for ${spec.marker}: ${next.error}`);
    }
    const row = TasksRepo.insertTask(db, {
      chat_id: chat.id,
      created_by: 'system',
      kind: spec.kind,
      cron_expr: spec.cron,
      timezone: spec.timezone,
      next_run_at: next.nextRunAt,
      prompt: spec.prompt,
      max_attempts: 3,
      catchup_policy: 'run_once',
    });
    console.log(
      `installed ${spec.marker} → ${row.id} next=${new Date(row.next_run_at).toISOString()}`,
    );
    installed++;
  }

  console.log(`\nsummary: installed=${installed} skipped=${skipped}`);
  db.close();
}

main();
