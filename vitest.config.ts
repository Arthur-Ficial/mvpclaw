import { defineConfig } from 'vitest/config';

/**
 * Single Vitest config covering unit, integration, and e2e tests.
 * `pnpm test` runs unit + integration; `pnpm test:e2e` runs e2e separately.
 *
 * Per project policy: every test that touches a provider hits the REAL provider.
 * No fake-fetch, no fake-claude-CLI, no fake-OpenRouter. `MVPCLAW_TEST_NOCACHE=1`
 * is set in .env so any cached-response replay layer (when added later) is
 * bypassed in canonical runs.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    reporters: ['verbose'],
  },
});
