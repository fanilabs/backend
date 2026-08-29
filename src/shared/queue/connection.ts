import { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';
import { logger } from '../logger/index.js';

const log = logger.child({ module: 'queue-connection' });

let connection: Redis | undefined;

/**
 * BullMQ requires its own Redis connection(s) with `maxRetriesPerRequest:
 * null` (it manages blocking commands itself) — this is intentionally
 * separate from src/shared/cache's client, which is tuned for short-lived
 * request/response cache lookups instead.
 */
export function getQueueConnection(): Redis {
  if (!connection) {
    connection = new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (error) => log.error({ err: error }, 'Queue Redis connection error'));
  }
  return connection;
}

export async function disconnectQueueConnection(): Promise<void> {
  const current = connection;
  connection = undefined;
  await current?.quit();
}
