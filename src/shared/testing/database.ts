import { PrismaClient } from '@prisma/client';

/**
 * Used to gate repository/integration test suites (docs/DATABASE.md,
 * ROADMAP.md §10 — the infrastructure layer's own tests run against a real
 * Postgres, never a mock) with `describe.skipIf(!(await isDatabaseAvailable()))`.
 * Environments without a reachable database (e.g. a sandbox with no Docker)
 * get an honest "skipped", not a false pass or a false failure.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}
