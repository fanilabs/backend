/**
 * Safe, non-production default environment values for the test process.
 * Loaded once via vitest's `setupFiles` (see vitest.config.ts) — before this
 * runs, importing anything that calls `getConfig()` (src/shared/config)
 * would throw, since real deployments intentionally have no built-in
 * defaults for secrets/connection strings (fail fast, don't guess).
 *
 * Uses `??=` so a developer's real `.env`/shell exports are never
 * overridden — this only fills gaps for CI/sandbox runs that don't source
 * a real `.env`.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://fanilab:fanilab@localhost:5432/fanilab_backend_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-only-access-secret-not-for-production-use-0000';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-not-for-production-use-0000';
