import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/shared/testing/env.ts'],
    include: ['src/**/*.{spec,test}.ts', 'tests/**/*.{spec,test}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{spec,test}.ts',
        // Barrel / re-export index files only. Module composition roots
        // (`src/modules/*/index.ts`) are deliberately NOT excluded: they
        // hold real conditional wiring — the `X_CONTRACT_ID ? real client :
        // 502-on-unconfigured fallback` branch documented in
        // docs/API_REFERENCE.md — that a blanket `src/**/index.ts` would
        // hide from the coverage report.
        'src/**/{domain,application,infrastructure,interface}/index.ts',
        'src/shared/**/index.ts',
      ],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
    },
  },
});
