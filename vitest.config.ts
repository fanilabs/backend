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
      exclude: ['src/**/*.{spec,test}.ts', 'src/**/index.ts'],
    },
  },
});
