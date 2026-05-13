/**
 * `withAppContext` — single source of truth for the loadConfig +
 * buildAppContext + try/finally db.close() boilerplate that every CLI
 * sub-command was duplicating.
 *
 * Usage:
 * ```ts
 * await withAppContext(args, async (built) => {
 *   const result = built.ctx.tools.list();
 *   writeOut(result, resolveOutputContext(args));
 * });
 * ```
 *
 * If `loadConfig` throws, the function calls `exitConfig` (which terminates
 * the process). If the body throws an `ExitError` (from `exitRuntime` etc.),
 * propagation is preserved by `db.close()` still firing in the `finally`.
 */
import { buildAppContext } from '../app/index.js';
import { loadConfig } from '../config/index.js';
import { exitConfig } from './exit.js';

type AppCtx = ReturnType<typeof buildAppContext>;

/**
 * Run `fn` with a freshly-built AppContext. The DB handle is closed on the
 * way out, even on error.
 *
 * @param args - The citty `args` record from the calling sub-command.
 * @param fn - Body that receives the built context.
 * @returns Whatever `fn` returns.
 */
export async function withAppContext<T>(
  args: Record<string, unknown>,
  fn: (built: AppCtx) => Promise<T> | T,
): Promise<T> {
  let built: AppCtx;
  try {
    const config = loadConfig(typeof args['config'] === 'string' ? args['config'] : undefined);
    built = buildAppContext(config);
  } catch (err) {
    exitConfig(err instanceof Error ? err.message : String(err));
  }
  try {
    return await fn(built);
  } finally {
    built.ctx.db.close();
  }
}
