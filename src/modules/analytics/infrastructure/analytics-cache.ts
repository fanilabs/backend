import type { Redis } from 'ioredis';

/**
 * Narrow cache port `cached-analytics-reader.ts` depends on, rather than
 * `ioredis`'s `Redis` type directly — keeps the decorator trivially
 * testable with an in-memory fake (see `__fixtures__/fakes.ts`) instead of
 * needing a real Redis connection in unit tests.
 */
export interface AnalyticsCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Thin adapter over the shared Redis client (`shared/cache`) — same
 * connection the rate limiter already uses, per this module's own
 * "short-TTL cache, no dedicated infra" design goal. */
export function createRedisAnalyticsCache(redis: Redis): AnalyticsCache {
  return {
    async get(key) {
      return redis.get(key);
    },
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, 'EX', ttlSeconds);
    },
  };
}
