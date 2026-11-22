import { PrismaClient } from '@prisma/client';

/**
 * Used to gate repository/integration test suites (docs/DATABASE.md,
 * ROADMAP.md §10 — the infrastructure layer's own tests run against a real
 * Postgres, never a mock) with `describe.skipIf(!(await isDatabaseAvailable()))`.
 * Environments without a reachable database (e.g. a sandbox with no Docker)
 * get an honest "skipped", not a false pass or a false failure.
 *
 * Database-backed CI jobs set `REQUIRE_DATABASE=true` so an unreachable
 * database fails the job loudly instead of silently skipping every suite.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    if (isDatabaseRequired()) {
      throw new Error(
        `Database is required (REQUIRE_DATABASE=true) but unavailable: ${describeDatabaseError(error)}`,
      );
    }
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * True when the current run must have a reachable database (database-backed
 * CI jobs). Optional local runs leave this unset and keep skipping.
 */
export function isDatabaseRequired(): boolean {
  const value = process.env.REQUIRE_DATABASE?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function describeDatabaseError(error: unknown): string {
  const host = process.env.DATABASE_HOST ?? process.env.PGHOST ?? 'unknown host';
  const port = process.env.DATABASE_PORT ?? process.env.PGPORT ?? 'unknown port';
  const message = error instanceof Error ? error.message : String(error);
  return `${host}:${port} — ${message}`;
}
