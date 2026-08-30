import { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';
import { logger } from '../logger/index.js';

const log = logger.child({ module: 'redis-client' });

let client: Redis | undefined;

/**
 * Shared Redis connection for caching. BullMQ (src/shared/queue) opens its
 * own dedicated connections per queue/worker rather than reusing this one —
 * mixing BullMQ's blocking commands with cache traffic on one connection is
 * a well-known footgun.
 */
export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: 3 });
    // ioredis logs raw, unstructured warnings to stderr for every connection
    // error if nothing is listening on 'error' — route it through the
    // structured logger instead so it's filterable like everything else.
    client.on('error', (error) => log.error({ err: error }, 'Redis connection error'));
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.quit();
}
