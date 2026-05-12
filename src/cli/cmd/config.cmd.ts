/**
 * `mvpclaw config` — get / set / validate / diff the SSOT config file.
 *
 * Full implementation arrives in ticket C10 (#34).
 */
import { defineCommand } from 'citty';
import { commonArgs, notYetImplemented } from './_common.js';

export const configCmd = defineCommand({
  meta: {
    name: 'config',
    description: 'Get / set / validate / diff the SSOT mvpclaw.config.json.',
  },
  args: { ...commonArgs },
  run: () => notYetImplemented('config', 'C10 / #34'),
});
