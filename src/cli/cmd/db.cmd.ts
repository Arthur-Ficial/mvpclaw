/**
 * `mvpclaw db` — query (read-only) / migrate / vacuum / dump the SQLite database.
 *
 * Full implementation arrives in ticket C10 (#34). The `migrate` sub-sub-command
 * is also exercised by the top-level `pnpm migrate` script and is implemented
 * earlier (P2) so the rest of the build can apply migrations.
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const dbCmd = defineCommand({
  meta: {
    name: 'db',
    description: 'Query (read-only) / migrate / vacuum / dump the SQLite database.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('db', 'C10 / #34'),
});
