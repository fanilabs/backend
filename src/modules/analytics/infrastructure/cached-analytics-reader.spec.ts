import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsReader, GmvByToken } from '../domain/index.js';
import type { AnalyticsCache } from './analytics-cache.js';
import { createCachedAnalyticsReader } from './cached-analytics-reader.js';

/** Minimal in-memory `AnalyticsCache` with per-entry expiry, mirroring the
 * adapter contract without touching Redis. */
function createInMemoryCache(): AnalyticsCache & { entries: Map<string, { value: string; expiresAt: number }> } {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  return {
    entries,
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
  };
}

function createSpyReader(overrides: Partial<AnalyticsReader> = {}): AnalyticsReader {
  return {
    getGmvByToken: vi.fn(async () => [
      { token: 'USDC', releasedAmount: 123n },
    ] as GmvByToken[]),
    getDeliveryFunnelCounts: vi.fn(async () => ({
      requested: 10,
      accepted: 8,
      pickedUp: 6,
      delivered: 5,
      cancelled: 1,
    })),
    getDriverTierCounts: vi.fn(async () => ({ bronze: 3, silver: 2, gold: 1 })),
    ...overrides,
  };
}

describe('createCachedAnalyticsReader', () => {
  it('caches repeated funnel reads', async () => {
    const reader = createSpyReader();
    const cache = createInMemoryCache();
    const cached = createCachedAnalyticsReader(reader, cache, 60);

    const first = await cached.getDeliveryFunnelCounts();
    const second = await cached.getDeliveryFunnelCounts();

    expect(second).toEqual(first);
    expect(reader.getDeliveryFunnelCounts).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the TTL expires', async () => {
    const reader = createSpyReader();
    const cache = createInMemoryCache();
    const cached = createCachedAnalyticsReader(reader, cache, 0);

    await cached.getDeliveryFunnelCounts();
    await cached.getDeliveryFunnelCounts();

    expect(reader.getDeliveryFunnelCounts).toHaveBeenCalledTimes(2);
  });

  it('round-trips the GMV bigint through the cache', async () => {
    const reader = createSpyReader();
    const cache = createInMemoryCache();
    const cached = createCachedAnalyticsReader(reader, cache, 60);

    const first = await cached.getGmvByToken();
    const second = await cached.getGmvByToken();

    expect(second).toEqual(first);
    expect(second[0]?.releasedAmount).toBe(123n);
    expect(reader.getGmvByToken).toHaveBeenCalledTimes(1);
  });

  it('isolates cache keys across metric families when interleaved', async () => {
    const reader = createSpyReader();
    const cache = createInMemoryCache();
    const cached = createCachedAnalyticsReader(reader, cache, 60);

    const gmv = await cached.getGmvByToken();
    const funnel = await cached.getDeliveryFunnelCounts();
    const tiers = await cached.getDriverTierCounts();

    expect(reader.getGmvByToken).toHaveBeenCalledTimes(1);
    expect(reader.getDeliveryFunnelCounts).toHaveBeenCalledTimes(1);
    expect(reader.getDriverTierCounts).toHaveBeenCalledTimes(1);

    const gmvAgain = await cached.getGmvByToken();
    const funnelAgain = await cached.getDeliveryFunnelCounts();
    const tiersAgain = await cached.getDriverTierCounts();

    expect(gmvAgain).toEqual(gmv);
    expect(funnelAgain).toEqual(funnel);
    expect(tiersAgain).toEqual(tiers);

    // Each family hits its own key: no underlying call count changes.
    expect(reader.getGmvByToken).toHaveBeenCalledTimes(1);
    expect(reader.getDeliveryFunnelCounts).toHaveBeenCalledTimes(1);
    expect(reader.getDriverTierCounts).toHaveBeenCalledTimes(1);

    // Each family occupies a distinct cache entry.
    expect(cache.entries.size).toBe(3);
  });

  it('refreshing one expired family leaves other families intact', async () => {
    const reader = createSpyReader();
    const cache = createInMemoryCache();
    const cached = createCachedAnalyticsReader(reader, cache, 60);

    const gmv = await cached.getGmvByToken();
    const funnel = await cached.getDeliveryFunnelCounts();
    const tiers = await cached.getDriverTierCounts();

    // Expire only the funnel entry, leaving GMV and tier entries valid.
    const funnelKey = [...cache.entries.keys()].find((key) => key.includes('funnel'));
    expect(funnelKey).toBeDefined();
    cache.entries.delete(funnelKey!);

    const funnelAgain = await cached.getDeliveryFunnelCounts();
    expect(funnelAgain).toEqual(funnel);
    expect(reader.getDeliveryFunnelCounts).toHaveBeenCalledTimes(2);

    // Other families still served from cache.
    expect(await cached.getGmvByToken()).toEqual(gmv);
    expect(await cached.getDriverTierCounts()).toEqual(tiers);
    expect(reader.getGmvByToken).toHaveBeenCalledTimes(1);
    expect(reader.getDriverTierCounts).toHaveBeenCalledTimes(1);
  });

  it('caches empty GMV and zero tier counts as valid values', async () => {
    const reader = createSpyReader({
      getGmvByToken: vi.fn(async () => [] as GmvByToken[]),
      getDriverTierCounts: vi.fn(async () => ({ bronze: 0, silver: 0, gold: 0 })),
    });
    const cache = createInMemoryCache();
    const cached = createCachedAnalyticsReader(reader, cache, 60);

    expect(await cached.getGmvByToken()).toEqual([]);
    expect(await cached.getDriverTierCounts()).toEqual({ bronze: 0, silver: 0, gold: 0 });

    // Empty/zero values are cached, not treated as misses.
    expect(await cached.getGmvByToken()).toEqual([]);
    expect(await cached.getDriverTierCounts()).toEqual({ bronze: 0, silver: 0, gold: 0 });

    expect(reader.getGmvByToken).toHaveBeenCalledTimes(1);
    expect(reader.getDriverTierCounts).toHaveBeenCalledTimes(1);
  });
});
