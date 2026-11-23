import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.unit.test.ts', 'src/**/*.unit.spec.ts'],
    exclude: ['**/*.integration.*', '**/*.e2e.*', 'node_modules'],
    testTimeout: 10000,
  },
});
