import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/shared/testing/env.ts'],
    // src-only: the end-to-end suite lives under tests/e2e/ and has its own
    // config (`vitest.e2e.config.ts`) + `test:e2e` script, so it runs only
    // on a schedule and on release branches (ROADMAP.md §10) — never as
    // part of this fast per-PR run.
    include: ['src/**/*.{spec,test}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{spec,test}.ts', 'src/**/index.ts'],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
    },
  },
});
