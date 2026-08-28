import type { AnalyticsReader } from '../../domain/index.js';
import type { AnalyticsCache } from '../analytics-cache.js';

/** Wraps a real `AnalyticsReader` and counts calls per method — used to
 * assert the cache actually prevents re-querying within the TTL. */
export function createCountingAnalyticsReader(reader: AnalyticsReader): AnalyticsReader & {
  callCounts: { getGmvByToken: number; getDeliveryFunnelCounts: number; getDriverTierCounts: number };
} {
  const callCounts = { getGmvByToken: 0, getDeliveryFunnelCounts: 0, getDriverTierCounts: 0 };
  return {
    callCounts,
    async getGmvByToken() {
      callCounts.getGmvByToken += 1;
      return reader.getGmvByToken();
    },
    async getDeliveryFunnelCounts() {
      callCounts.getDeliveryFunnelCounts += 1;
      return reader.getDeliveryFunnelCounts();
    },
    async getDriverTierCounts() {
      callCounts.getDriverTierCounts += 1;
      return reader.getDriverTierCounts();
    },
  };
}

/**
 * In-memory `AnalyticsCache` for tests — TTL expiry is driven by an
 * injectable clock (`advance`) instead of real timers, so tests asserting
 * "stale after the TTL" don't need to actually sleep.
 */
export function createInMemoryAnalyticsCache(): AnalyticsCache & { advance(seconds: number): void } {
  const store = new Map<string, { value: string; expiresAtSeconds: number }>();
  let nowSeconds = 0;

  return {
    advance(seconds) {
      nowSeconds += seconds;
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAtSeconds <= nowSeconds) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value, expiresAtSeconds: nowSeconds + ttlSeconds });
    },
  };
}
