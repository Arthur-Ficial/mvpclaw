/**
 * `mvpclaw trace` — list / show / tail / filter agent-run JSONL traces.
 *
 * Trace files live at `<dataDir>/traces/<runId>.jsonl`. Each line is
 * a single JSON event written by `src/app/run-tracer.ts`.
 */
import { defineCommand } from 'citty';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAppContext } from '../../app/index.js';
import { loadConfig } from '../../config/index.js';
import { exitConfig, exitNotFound } from '../exit.js';
import { resolveOutputContext, writeJsonLine, writeOut } from '../output.js';
import { commonArgs } from './_common.js';

function resolveTracesDir(configFlag: string | undefined): string {
  const config = loadConfig(configFlag);
  return resolve(process.cwd(), config.app.dataDir, 'traces');
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List recent agent-run trace files.' },
  args: {
    ...commonArgs,
    limit: { type: 'string', description: 'Max files (default 20).', default: '20' },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let dir: string;
    try {
      dir = resolveTracesDir(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    if (!existsSync(dir)) {
      writeOut([], ctx);
      return;
    }
    const limit = Number(args.limit);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const st = statSync(join(dir, f));
        return {
          runId: f.replace(/\.jsonl$/, ''),
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
      .slice(0, limit);
    writeOut(files, ctx);
  },
});

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Print the JSONL events for one run.' },
  args: {
    ...commonArgs,
    'run-id': { type: 'positional', description: 'Agent run id.', required: true },
    'event-type': {
      type: 'string',
      description: 'Filter to a single event type (e.g. provider_event).',
      required: false,
    },
  },
  run({ args }) {
    const ctx = resolveOutputContext(args);
    let dir: string;
    try {
      dir = resolveTracesDir(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const path = join(dir, `${String(args['run-id'])}.jsonl`);
    if (!existsSync(path)) {
      exitNotFound(`trace file not found: ${path}`);
    }
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as { type: string });
    const filtered =
      typeof args['event-type'] === 'string' && args['event-type'].length > 0
        ? events.filter((e) => e.type === args['event-type'])
        : events;
    if (ctx.json) {
      for (const e of filtered) {
        writeJsonLine(e);
      }
    } else {
      writeOut(filtered, ctx);
    }
  },
});

const tailCmd = defineCommand({
  meta: { name: 'tail', description: 'Print recent trace events. With --follow, stream new ones.' },
  args: {
    ...commonArgs,
    'run-id': { type: 'string', description: 'Specific run id (optional).', required: false },
    limit: { type: 'string', default: '20' },
    follow: { type: 'boolean', default: false },
  },
  async run({ args }) {
    let dir: string;
    try {
      dir = resolveTracesDir(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    if (!existsSync(dir)) {
      return;
    }
    const limit = Number(args.limit);

    /** Read the latest events across all traces in chronological order. */
    function readAllEvents(): Array<{ runId: string; event: unknown; line: string }> {
      const files =
        typeof args['run-id'] === 'string'
          ? [`${args['run-id']}.jsonl`]
          : readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      const collected: Array<{ runId: string; event: unknown; line: string }> = [];
      for (const f of files) {
        const path = join(dir, f);
        if (!existsSync(path)) {
          continue;
        }
        const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          collected.push({ runId: f.replace(/\.jsonl$/, ''), event: JSON.parse(line), line });
        }
      }
      return collected;
    }

    const seed = readAllEvents().slice(-limit);
    for (const { event } of seed) {
      writeJsonLine(event);
    }
    if (!args.follow) {
      return;
    }
    let seenLines = new Set(seed.map((s) => s.line));
    while (true) {
      await new Promise((r) => setTimeout(r, 500));
      const all = readAllEvents();
      const fresh = all.filter((e) => !seenLines.has(e.line));
      for (const { event } of fresh) {
        writeJsonLine(event);
      }
      seenLines = new Set(all.map((s) => s.line));
    }
  },
});

export const traceCmd = defineCommand({
  meta: { name: 'trace', description: 'List / show / tail / filter agent-run JSONL traces.' },
  args: { ...commonArgs },
  subCommands: { list: listCmd, show: showCmd, tail: tailCmd },
});

/** Suppress unused-var lint when these are not exercised in the slim path. */
void buildAppContext;
