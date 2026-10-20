import { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';
import { logger } from '../logger/index.js';
import { withTimeout } from '../shutdown/index.js';

export const REDIS_DISCONNECT_TIMEOUT_MS = 2_000;

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
  if (!current) return;
  try {
    await withTimeout(() => current.quit(), REDIS_DISCONNECT_TIMEOUT_MS, 'RedisClient');
  } catch (error: unknown) {
    log.warn({ err: error }, 'Redis quit did not complete — force disconnecting socket');
    current.disconnect();
  }
}
