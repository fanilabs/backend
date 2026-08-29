import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config/index.js';

let client: PrismaClient | undefined;

/**
 * Single Prisma client for the process (both the API and worker processes
 * each get their own instance, per process — this is not shared across
 * processes). Prisma manages its own connection pool internally, so
 * repositories should import this rather than constructing their own client.
 */
export function getPrismaClient(): PrismaClient {
  client ??= new PrismaClient({
    log: getConfig().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.$disconnect();
}
