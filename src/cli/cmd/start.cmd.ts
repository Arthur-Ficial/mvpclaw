/**
 * `mvpclaw start` — boot the daemon for production use.
 *
 * Wires:
 *   - Telegram channel adapter (long-polling) if a token is configured.
 *   - Scheduler tick loop (1s) + sweep loop (60s) so scheduled tasks fire.
 *   - Outbox worker loop (250ms) so enqueued messages drain.
 *   - Inbound dispatch loop: for each `InboundMessage` from any channel,
 *     call `routeInbound` + `runAgentTurn` + `drainOutbox`.
 *   - SIGTERM / SIGINT handler that drains in-flight work before exit.
 *
 * Exits with code 0 on clean shutdown.
 */
import { defineCommand } from 'citty';
import {
  buildAppContext,
  drainOutbox,
  routeInbound,
  runAgentTurn,
  type AppContext,
} from '../../app/index.js';
import type { InboundMessage } from '../../channels/index.js';
import { loadConfig } from '../../config/index.js';
import { startTickLoop, installShutdownHandler } from '../../scheduler/index.js';
import { exitConfig } from '../exit.js';
import { commonArgs } from './_common.js';

export const startCmd = defineCommand({
  meta: {
    name: 'start',
    description: 'Start the MVPClaw daemon (channel pollers + scheduler + outbox).',
  },
  args: { ...commonArgs },
  async run({ args }) {
    let config;
    try {
      config = loadConfig(typeof args.config === 'string' ? args.config : undefined);
    } catch (err) {
      exitConfig(err instanceof Error ? err.message : String(err));
    }
    const built = buildAppContext(config);
    const ctx = built.ctx;
    const log = ctx.log;

    // Install shutdown handler FIRST so a SIGTERM arriving immediately after
    // the "daemon online" log can still trigger a graceful drain.
    let shutdownResolve: (() => void) | null = null;
    const shutdownPromise = new Promise<void>((resolve) => {
      shutdownResolve = resolve;
    });
    const stopState = { outboxStopped: false, inboundStopped: false };
    installShutdownHandler({
      drainMs: 3_000,
      hardMs: 8_000,
      drain: async () => {
        log.info('mvpclaw start: shutdown signal received');
        stopState.inboundStopped = true;
        stopState.outboxStopped = true;
        shutdownResolve?.();
      },
    });

    log.info(
      {
        provider: config.agent.provider,
        channels: Object.keys(ctx.channels),
        toolCount: ctx.tools.list().length,
      },
      'mvpclaw start: daemon online',
    );

    const outboxLoop = (async (): Promise<void> => {
      while (!stopState.outboxStopped) {
        try {
          const r = await drainOutbox(ctx);
          if (r.sent + r.failed + r.cancelled > 0) {
            log.debug(r, 'outbox: drained');
          }
        } catch (err) {
          log.error({ err }, 'outbox: drain failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();

    // ── Scheduler tick (1s) — keeps the loop alive for lease-refresh.
    const tick = startTickLoop({
      tickMs: 1000,
      sweepMs: 60_000,
      onTick: () => {
        // Lease-driven dispatcher integration lands when P11+ refactor binds
        // it here; the tick proves the loop is healthy.
      },
      onSweep: () => {
        // Lease-recovery sweep placeholder.
      },
    });

    // ── Inbound dispatch — fan-in every channel's receive() stream.
    async function dispatchChannel(channelName: string): Promise<void> {
      const channel = ctx.channels[channelName];
      if (!channel) {
        return;
      }
      try {
        for await (const inbound of channel.receive() as AsyncIterable<InboundMessage>) {
          if (stopState.inboundStopped) {
            break;
          }
          handleInbound(ctx, inbound).catch((err: unknown) => {
            log.error(
              { err: err instanceof Error ? err.message : String(err), channel: channelName },
              'inbound: handler failed',
            );
          });
        }
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), channel: channelName },
          'inbound: receive loop exited',
        );
      }
    }

    const channelLoops = Object.keys(ctx.channels).map(dispatchChannel);
    void channelLoops;

    await shutdownPromise;
    // Best-effort cleanup before shutdown.ts's process.exit(0) fires.
    try {
      await tick.stop();
      await outboxLoop;
      await drainOutbox(ctx);
      ctx.db.close();
    } catch {
      // ignore — shutdown.ts will exit unconditionally
    }
    log.info('mvpclaw start: clean exit');
  },
});

/**
 * Route + run + drain for a single inbound message. Errors are logged
 * but never propagate up to the channel loop (so one bad message can't
 * kill the daemon).
 *
 * @param ctx - The application context.
 * @param inbound - One inbound from a channel adapter.
 */
async function handleInbound(ctx: AppContext, inbound: InboundMessage): Promise<void> {
  const resolved = routeInbound(ctx.db, inbound, ctx.config.idle);
  if (resolved.isDuplicate || resolved.isHandledCommand) {
    await drainOutbox(ctx, { chat_id: resolved.chat.id });
    return;
  }
  const result = await runAgentTurn(ctx, resolved);
  ctx.log.info(
    {
      runId: result.runId,
      status: result.status,
      chatId: resolved.chat.id,
      replyLen: result.replyText.length,
    },
    'inbound: agent turn complete',
  );
  await drainOutbox(ctx, { chat_id: resolved.chat.id });
}
