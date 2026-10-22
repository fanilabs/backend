import { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';
import { logger } from '../logger/index.js';
import { withTimeout } from '../shutdown/index.js';

const log = logger.child({ module: 'redis-client' });

/**
 * How long `disconnectRedis` waits for Redis's graceful QUIT before
 * force-closing the socket instead. When the container orchestrator stops
 * Redis and the API at the same time, QUIT never resolves — waiting on it
 * indefinitely held process shutdown past the orchestrator's grace period
 * (#355).
 */
export const REDIS_DISCONNECT_TIMEOUT_MS = 3_000;

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
    await withTimeout(() => current.quit(), REDIS_DISCONNECT_TIMEOUT_MS, 'Redis');
  } catch (error: unknown) {
    // Best-effort teardown: if QUIT hangs (unreachable Redis) or rejects,
    // drop the socket outright so shutdown is never held hostage by a
    // connection that can no longer complete a round-trip (#355).
    log.warn({ err: error }, 'Redis quit did not complete — force disconnecting socket');
    current.disconnect();
  }
}
