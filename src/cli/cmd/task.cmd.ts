/**
 * `mvpclaw task` — full task lifecycle from the CLI.
 *
 * Schedule / list / show / cancel / pause / resume / run-now / update.
 * Wraps the same TasksRepo + parseWhen the agent-facing tools use.
 */
import { defineCommand } from 'citty';
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { TasksRepo, type TaskRow, type TaskState } from '../../db/index.js';
import { parseWhen } from '../../scheduler/recurrence.js';
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

const scheduleCmd = defineCommand({
  meta: { name: 'schedule', description: 'Schedule a future or recurring task.' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', description: 'Internal chat id.', required: true },
    prompt: { type: 'string', description: 'Prompt text the agent will run.', required: true },
    when: {
      type: 'string',
      description: 'ISO 8601 (one-shot) OR cron expression (recurring).',
      required: true,
    },
    timezone: { type: 'string', description: 'IANA timezone.', default: 'Europe/Vienna' },
    skill: { type: 'string', required: false },
    catchup: {
      type: 'string',
      description: 'run_once | run_all_missed | skip',
      default: 'run_once',
    },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const parsed = parseWhen(String(args.when), String(args.timezone));
      if (!parsed.ok) {
        exitUsage(parsed.error);
      }
      const row = TasksRepo.insertTask(built.ctx.db, {
        chat_id: String(args['chat-id']),
        created_by: 'user',
        kind: parsed.kind,
        cron_expr: parsed.cronExpr,
        timezone: String(args.timezone),
        next_run_at: parsed.nextRunAt,
        prompt: String(args.prompt),
        skill: typeof args.skill === 'string' ? args.skill : null,
        catchup_policy: String(args.catchup) as 'run_once' | 'run_all_missed' | 'skip',
      });
      writeOut(row, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List tasks.' },
  args: {
    ...commonArgs,
    'chat-id': { type: 'string', required: false },
    state: { type: 'string', required: false },
    'include-completed': { type: 'boolean', default: false },
    'include-dead': { type: 'boolean', default: false },
    limit: { type: 'string', default: '100' },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      let rows = TasksRepo.listTasks(built.ctx.db, {
        ...(typeof args['chat-id'] === 'string' ? { chat_id: args['chat-id'] } : {}),
        ...(typeof args.state === 'string' ? { state: args.state as TaskState } : {}),
        limit: Number(args.limit),
      });
      if (!args['include-completed']) {
        rows = rows.filter((r) => r.state !== 'completed');
      }
      if (!args['include-dead']) {
        rows = rows.filter((r) => r.state !== 'dead');
      }
      writeOut(rows, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show a single task.' },
  args: { ...commonArgs, id: { type: 'positional', required: true } },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = TasksRepo.findTaskById(built.ctx.db, String(args.id));
      if (!row) {
        exitNotFound(`task "${String(args.id)}" not found`);
      }
      writeOut(row, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const cancelCmd = defineCommand({
  meta: { name: 'cancel', description: 'Cancel a task.' },
  args: { ...commonArgs, id: { type: 'positional', required: true } },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = TasksRepo.findTaskById(built.ctx.db, String(args.id));
      if (!row) {
        exitNotFound(`task "${String(args.id)}" not found`);
      }
      TasksRepo.markTaskCancelled(built.ctx.db, row.id);
      writeOut({ id: row.id, state: 'cancelled' }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const pauseCmd = defineCommand({
  meta: { name: 'pause', description: 'Pause a scheduled task.' },
  args: { ...commonArgs, id: { type: 'positional', required: true } },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = TasksRepo.findTaskById(built.ctx.db, String(args.id));
      if (!row) {
        exitNotFound(`task "${String(args.id)}" not found`);
      }
      TasksRepo.setTaskPaused(built.ctx.db, row.id, true);
      writeOut({ id: row.id, state: 'paused' }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const resumeCmd = defineCommand({
  meta: { name: 'resume', description: 'Resume a paused task.' },
  args: { ...commonArgs, id: { type: 'positional', required: true } },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = TasksRepo.findTaskById(built.ctx.db, String(args.id));
      if (!row) {
        exitNotFound(`task "${String(args.id)}" not found`);
      }
      TasksRepo.setTaskPaused(built.ctx.db, row.id, false);
      writeOut({ id: row.id, state: 'scheduled' }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const runNowCmd = defineCommand({
  meta: { name: 'run-now', description: 'Bypass schedule and fire a task immediately (CLI-only).' },
  args: { ...commonArgs, id: { type: 'positional', required: true } },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = TasksRepo.findTaskById(built.ctx.db, String(args.id));
      if (!row) {
        exitNotFound(`task "${String(args.id)}" not found`);
      }
      // Simply move next_run_at to now; the next tick (P11) picks it up
      // when the dispatcher exists. For now also flag a hint in stdout.
      built.ctx.db
        .prepare('UPDATE tasks SET next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(Date.now(), Date.now(), row.id);
      writeOut({ id: row.id, nextRunAt: Date.now(), note: 'next_run_at moved to now' }, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

const updateCmd = defineCommand({
  meta: { name: 'update', description: 'Update prompt / when / timezone / paused on a task.' },
  args: {
    ...commonArgs,
    id: { type: 'positional', required: true },
    prompt: { type: 'string', required: false },
    when: { type: 'string', required: false },
    timezone: { type: 'string', required: false },
    paused: { type: 'boolean', required: false },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    const built = open(args);
    try {
      const row = TasksRepo.findTaskById(built.ctx.db, String(args.id));
      if (!row) {
        exitNotFound(`task "${String(args.id)}" not found`);
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if (typeof args.prompt === 'string') {
        sets.push('prompt = ?');
        params.push(args.prompt);
      }
      if (typeof args.when === 'string') {
        const tz = typeof args.timezone === 'string' ? args.timezone : row.timezone;
        const parsed = parseWhen(args.when, tz);
        if (!parsed.ok) {
          exitUsage(parsed.error);
        }
        sets.push('next_run_at = ?', 'cron_expr = ?', 'kind = ?');
        params.push(parsed.nextRunAt, parsed.cronExpr, parsed.kind);
      }
      if (typeof args.timezone === 'string') {
        sets.push('timezone = ?');
        params.push(args.timezone);
      }
      if (sets.length > 0) {
        sets.push('updated_at = ?');
        params.push(Date.now(), row.id);
        built.ctx.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }
      if (typeof args.paused === 'boolean') {
        TasksRepo.setTaskPaused(built.ctx.db, row.id, args.paused);
      }
      writeOut(TasksRepo.findTaskById(built.ctx.db, row.id) as TaskRow, ctx);
    } finally {
      built.ctx.db.close();
    }
  },
});

export const taskCmd = defineCommand({
  meta: {
    name: 'task',
    description: 'Schedule / list / show / cancel / pause / resume / run-now / update tasks.',
  },
  args: { ...commonArgs },
  subCommands: {
    schedule: scheduleCmd,
    list: listCmd,
    show: showCmd,
    cancel: cancelCmd,
    pause: pauseCmd,
    resume: resumeCmd,
    'run-now': runNowCmd,
    update: updateCmd,
  },
});
