import { describe, expect, it } from 'vitest';
import { createCachedAnalyticsReader } from './cached-analytics-reader.js';
import { createFakeAnalyticsReader } from '../application/__fixtures__/fakes.js';
import { createCountingAnalyticsReader, createInMemoryAnalyticsCache } from './__fixtures__/fakes.js';

const TTL_SECONDS = 30;

describe('createCachedAnalyticsReader', () => {
  it('does not re-query the underlying reader for repeated calls within the TTL', async () => {
    const underlying = createFakeAnalyticsReader();
    underlying.setTierCounts({ bronze: 2, silver: 1, gold: 3 });
    const spy = createCountingAnalyticsReader(underlying);
    const cache = createInMemoryAnalyticsCache();
    const cachedReader = createCachedAnalyticsReader(spy, cache, TTL_SECONDS);

    await cachedReader.getDriverTierCounts();
    await cachedReader.getDriverTierCounts();
    const result = await cachedReader.getDriverTierCounts();

    expect(spy.callCounts.getDriverTierCounts).toBe(1);
    expect(result).toEqual({ bronze: 2, silver: 1, gold: 3 });
  });

  it('re-queries and returns fresh values once the TTL expires', async () => {
    const underlying = createFakeAnalyticsReader();
    underlying.setFunnelCounts({ totalDeliveries: 10, deliveredCount: 5, disputedCount: 1 });
    const spy = createCountingAnalyticsReader(underlying);
    const cache = createInMemoryAnalyticsCache();
    const cachedReader = createCachedAnalyticsReader(spy, cache, TTL_SECONDS);

    await cachedReader.getDeliveryFunnelCounts();
    expect(spy.callCounts.getDeliveryFunnelCounts).toBe(1);

    cache.advance(TTL_SECONDS + 1);
    underlying.setFunnelCounts({ totalDeliveries: 20, deliveredCount: 15, disputedCount: 2 });
    const afterExpiry = await cachedReader.getDeliveryFunnelCounts();

    expect(spy.callCounts.getDeliveryFunnelCounts).toBe(2);
    expect(afterExpiry).toEqual({ totalDeliveries: 20, deliveredCount: 15, disputedCount: 2 });
  });

  it('round-trips getGmvByToken bigint amounts through the cache without precision loss', async () => {
    const underlying = createFakeAnalyticsReader();
    const hugeAmount = 170141183460469231731687303715884105727n;
    underlying.setGmv([{ token: 'XLM', releasedAmount: hugeAmount, releasedCount: 2 }]);
    const spy = createCountingAnalyticsReader(underlying);
    const cache = createInMemoryAnalyticsCache();
    const cachedReader = createCachedAnalyticsReader(spy, cache, TTL_SECONDS);

    await cachedReader.getGmvByToken();
    const cached = await cachedReader.getGmvByToken();

    expect(spy.callCounts.getGmvByToken).toBe(1);
    expect(cached).toEqual([{ token: 'XLM', releasedAmount: hugeAmount, releasedCount: 2 }]);
  });
});

describe('createCachedAnalyticsReader resilience (#432)', () => {
  it('falls back to underlying reader on Redis rejection or corrupt JSON', async () => {
    const reader = {
      getGmvByToken: async () => [{ token: 'USDC', releasedAmount: 100n }],
      getDeliveryFunnelCounts: async () => ({ pending: 1, active: 0, inTransit: 0, delivered: 2, disputed: 0, cancelled: 0 }),
      getDriverTierCounts: async () => ({ bronze: 1, silver: 0, gold: 0, platinum: 0 }),
    };
    const brokenCache = {
      get: async () => '{invalid-json',
      set: async () => {
        throw new Error('Redis write error');
      },
    };
    const cached = createCachedAnalyticsReader(reader as never, brokenCache, 30);
    await expect(cached.getGmvByToken()).resolves.toEqual([{ token: 'USDC', releasedAmount: 100n }]);
  });
});
