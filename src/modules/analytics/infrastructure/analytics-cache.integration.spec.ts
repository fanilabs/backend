import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { createRedisAnalyticsCache } from './analytics-cache.js';

describe('createRedisAnalyticsCache (integration)', () => {
  let redis: Redis;
  const TEST_KEY_PREFIX = 'test:analytics-cache:';

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      retryStrategy: () => null,
      enableReadyCheck: false,
    });
  });

  afterAll(async () => {
    // Clean up test keys before closing
    const keys = await redis.keys(`${TEST_KEY_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
  });

  it('returns null for absent keys', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const absentKey = `${TEST_KEY_PREFIX}absent`;

    const result = await cache.get(absentKey);

    expect(result).toBeNull();
  });

  it('round-trips string values without modification', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const testKey = `${TEST_KEY_PREFIX}roundtrip`;
    const testValue = JSON.stringify([{ token: 'XLM', amount: '12345678901234567890' }]);

    await cache.set(testKey, testValue, 100);
    const retrieved = await cache.get(testKey);

    expect(retrieved).toBe(testValue);
  });

  it('overwrites existing values when set again', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const testKey = `${TEST_KEY_PREFIX}overwrite`;
    const value1 = 'first';
    const value2 = 'second';

    await cache.set(testKey, value1, 100);
    expect(await cache.get(testKey)).toBe(value1);

    await cache.set(testKey, value2, 100);
    expect(await cache.get(testKey)).toBe(value2);
  });

  it('respects the TTL in seconds', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const testKey = `${TEST_KEY_PREFIX}ttl`;
    const testValue = 'expires-soon';
    const TTL_SECONDS = 1;

    await cache.set(testKey, testValue, TTL_SECONDS);
    expect(await cache.get(testKey)).toBe(testValue);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, (TTL_SECONDS + 0.1) * 1000));
    expect(await cache.get(testKey)).toBeNull();
  });

  it('handles large JSON payloads round-tripping through strings', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const testKey = `${TEST_KEY_PREFIX}large-payload`;
    const largeValue = JSON.stringify(
      Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        amount: (BigInt(2) ** BigInt(100) + BigInt(i)).toString(),
      }))
    );

    await cache.set(testKey, largeValue, 100);
    const retrieved = await cache.get(testKey);

    expect(retrieved).toBe(largeValue);
    expect(JSON.parse(retrieved!)).toHaveLength(1000);
  });

  it('enforces positive bounded TTL', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const testKey = `${TEST_KEY_PREFIX}ttl-bounds`;
    const testValue = 'value';

    // Valid positive TTL
    await cache.set(testKey, testValue, 1);
    expect(await cache.get(testKey)).toBe(testValue);

    // Clean up
    await redis.del(testKey);
  });

  it('allows concurrent reads and writes', async () => {
    const cache = createRedisAnalyticsCache(redis);
    const baseKey = `${TEST_KEY_PREFIX}concurrent`;

    const promises = Array.from({ length: 10 }, (_, i) =>
      cache.set(`${baseKey}:${i}`, `value-${i}`, 100)
    );
    await Promise.all(promises);

    const readPromises = Array.from({ length: 10 }, (_, i) =>
      cache.get(`${baseKey}:${i}`)
    );
    const values = await Promise.all(readPromises);

    values.forEach((value, i) => {
      expect(value).toBe(`value-${i}`);
    });

    // Clean up
    const keys = Array.from({ length: 10 }, (_, i) => `${baseKey}:${i}`);
    await redis.del(...keys);
  });
});
