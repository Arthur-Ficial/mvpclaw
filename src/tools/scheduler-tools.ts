/**
 * Scheduler tools — `schedule_task`, `cancel_task`, `list_tasks`,
 * `update_task` — registered as `source: 'builtin'` in the ToolRegistry
 * so the agent can invoke them today. P8 will additionally expose them
 * via the internal MCP server.
 *
 * Per spec §27.3 + §27.5 — including the `max_active_per_chat = 20` cap.
 */
import { TasksRepo, type TaskRow } from '../db/index.js';
import { parseWhen } from '../scheduler/recurrence.js';
import type { ToolHandler } from './tool.js';
import type { ToolRegistry } from './tool-registry.js';

/** Hard cap from spec §27.3. */
const MAX_ACTIVE_PER_CHAT = 20;

/**
 * Register the four scheduler tools on `registry`.
 *
 * @param registry - The shared ToolRegistry instance.
 */
export function registerSchedulerTools(registry: ToolRegistry): void {
  registry.register(scheduleTaskTool());
  registry.register(cancelTaskTool());
  registry.register(listTasksTool());
  registry.register(updateTaskTool());
}

function scheduleTaskTool(): ToolHandler {
  return {
    definition: {
      name: 'schedule_task',
      description:
        'Schedule a future or recurring agent run for the current chat. `when` is ISO 8601 (one-shot) or a cron expression (recurring).',
      inputSchema: {
        type: 'object',
        required: ['chat_id', 'prompt', 'when'],
        properties: {
          chat_id: { type: 'string' },
          prompt: { type: 'string', minLength: 1, maxLength: 4000 },
          when: { type: 'string' },
          timezone: { type: 'string', default: 'Europe/Vienna' },
          skill: { type: 'string' },
          catchup_policy: {
            type: 'string',
            enum: ['run_once', 'run_all_missed', 'skip'],
            default: 'run_once',
          },
        },
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input, ctx): Promise<TaskRow> {
      const p = input as {
        chat_id: string;
        prompt: string;
        when: string;
        timezone?: string;
        skill?: string;
        catchup_policy?: 'run_once' | 'run_all_missed' | 'skip';
      };
      const tz = p.timezone ?? 'Europe/Vienna';
      const parsed = parseWhen(p.when, tz);
      if (!parsed.ok) {
        throw new Error(`schedule_task: invalid \`when\`: ${parsed.error}`);
      }
      const active = TasksRepo.countTasksByChat(ctx.db, p.chat_id, 'scheduled');
      if (active >= MAX_ACTIVE_PER_CHAT) {
        throw new Error(
          `schedule_task: chat ${p.chat_id} has reached the per-chat limit (${MAX_ACTIVE_PER_CHAT} active)`,
        );
      }
      const row = TasksRepo.insertTask(ctx.db, {
        chat_id: p.chat_id,
        created_by: 'agent',
        kind: parsed.kind,
        cron_expr: parsed.cronExpr,
        timezone: tz,
        next_run_at: parsed.nextRunAt,
        prompt: p.prompt,
        skill: p.skill ?? null,
        catchup_policy: p.catchup_policy ?? 'run_once',
      });
      return Promise.resolve(row);
    },
  };
}

function cancelTaskTool(): ToolHandler {
  return {
    definition: {
      name: 'cancel_task',
      description: 'Cancel a scheduled task by id. Idempotent on terminal states.',
      inputSchema: {
        type: 'object',
        required: ['task_id'],
        properties: { task_id: { type: 'string' } },
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input, ctx): Promise<{ id: string; state: string }> {
      const p = input as { task_id: string };
      const row = TasksRepo.findTaskById(ctx.db, p.task_id);
      if (!row) {
        throw new Error(`cancel_task: task ${p.task_id} not found`);
      }
      TasksRepo.markTaskCancelled(ctx.db, p.task_id);
      return Promise.resolve({ id: p.task_id, state: 'cancelled' });
    },
  };
}

function listTasksTool(): ToolHandler {
  return {
    definition: {
      name: 'list_tasks',
      description: 'List tasks for a chat. Optional state filter.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string' },
          state: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
      source: 'builtin',
      enabled: true,
    },
    execute(input, ctx): Promise<TaskRow[]> {
      const p = input as { chat_id?: string; state?: TaskRow['state']; limit?: number };
      return Promise.resolve(
        TasksRepo.listTasks(ctx.db, {
          ...(p.chat_id !== undefined ? { chat_id: p.chat_id } : {}),
          ...(p.state !== undefined ? { state: p.state } : {}),
          limit: p.limit ?? 50,
        }),
      );
    },
  };
}

function updateTaskTool(): ToolHandler {
  return {
    definition: {
      name: 'update_task',
      description: 'Update a task: prompt, when (re-parse), timezone, paused state.',
      inputSchema: {
        type: 'object',
        required: ['task_id'],
        properties: {
          task_id: { type: 'string' },
          prompt: { type: 'string' },
          when: { type: 'string' },
          timezone: { type: 'string' },
          paused: { type: 'boolean' },
        },
      },
      source: 'builtin',
      enabled: true,
    },
    async execute(input, ctx): Promise<TaskRow> {
      const p = input as {
        task_id: string;
        prompt?: string;
        when?: string;
        timezone?: string;
        paused?: boolean;
      };
      const row = TasksRepo.findTaskById(ctx.db, p.task_id);
      if (!row) {
        throw new Error(`update_task: task ${p.task_id} not found`);
      }
      const sets: string[] = [];
      const args: unknown[] = [];
      if (p.prompt !== undefined) {
        sets.push('prompt = ?');
        args.push(p.prompt);
      }
      if (p.when !== undefined) {
        const tz = p.timezone ?? row.timezone;
        const parsed = parseWhen(p.when, tz);
        if (!parsed.ok) {
          throw new Error(`update_task: invalid \`when\`: ${parsed.error}`);
        }
        sets.push('next_run_at = ?');
        args.push(parsed.nextRunAt);
        sets.push('cron_expr = ?');
        args.push(parsed.cronExpr);
        sets.push('kind = ?');
        args.push(parsed.kind);
      }
      if (p.timezone !== undefined) {
        sets.push('timezone = ?');
        args.push(p.timezone);
      }
      if (sets.length > 0) {
        sets.push('updated_at = ?');
        args.push(Date.now());
        args.push(p.task_id);
        ctx.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
      }
      if (p.paused !== undefined) {
        TasksRepo.setTaskPaused(ctx.db, p.task_id, p.paused);
      }
      return TasksRepo.findTaskById(ctx.db, p.task_id) as TaskRow;
    },
  };
}
