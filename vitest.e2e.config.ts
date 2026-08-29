import { defineConfig } from 'vitest/config';

// The end-to-end suite gets its own config/project so it only runs where it
// is supposed to (ROADMAP.md §10: on a schedule and on release branches,
// given its higher cost/flakiness surface) — never as part of the fast
// per-PR `pnpm test` run. See `tests/e2e/README.md`.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/shared/testing/env.ts'],
    include: ['tests/e2e/**/*.{spec,test}.ts'],
  },
});
