import type { AnalyticsReader, GmvByToken } from '../domain/index.js';
import type { AnalyticsCache } from './analytics-cache.js';

const CACHE_KEY_PREFIX = 'analytics:v1:';
const GMV_KEY = `${CACHE_KEY_PREFIX}gmv-by-token`;
const FUNNEL_KEY = `${CACHE_KEY_PREFIX}delivery-funnel-counts`;
const TIER_KEY = `${CACHE_KEY_PREFIX}driver-tier-counts`;

/** `GmvByToken.releasedAmount` is a `bigint` — `JSON.stringify` throws on
 * `bigint` by default, so it's round-tripped through a string explicitly
 * rather than relying on a generic serializer for this one field. */
type CachedGmvByToken = Omit<GmvByToken, 'releasedAmount'> & { releasedAmount: string };

/**
 * Decorates a real `AnalyticsReader` with a short-TTL read-through cache,
 * keyed per metric, so repeated admin-dashboard refreshes within the TTL
 * don't re-run full-table `count`/`groupBy` queries (`ARCHITECTURE.md`'s
 * "computed from read models" design plus the cost characteristics noted
 * in `docs/API_REFERENCE.md`'s analytics section). Values become stale for
 * at most `ttlSeconds` after the underlying data changes — acceptable for
 * dashboard-refresh use, not for anything requiring read-your-writes
 * consistency.
 */
export function createCachedAnalyticsReader(
  reader: AnalyticsReader,
  cache: AnalyticsCache,
  ttlSeconds: number,
): AnalyticsReader {
  return {
    async getGmvByToken() {
      const cached = await cache.get(GMV_KEY);
      if (cached) {
        const rows = JSON.parse(cached) as CachedGmvByToken[];
        return rows.map((row) => ({ ...row, releasedAmount: BigInt(row.releasedAmount) }));
      }

      const rows = await reader.getGmvByToken();
      const serializable: CachedGmvByToken[] = rows.map((row) => ({
        ...row,
        releasedAmount: row.releasedAmount.toString(),
      }));
      await cache.set(GMV_KEY, JSON.stringify(serializable), ttlSeconds);
      return rows;
    },

    async getDeliveryFunnelCounts() {
      const cached = await cache.get(FUNNEL_KEY);
      if (cached) {
        return JSON.parse(cached) as Awaited<ReturnType<AnalyticsReader['getDeliveryFunnelCounts']>>;
      }

      const counts = await reader.getDeliveryFunnelCounts();
      await cache.set(FUNNEL_KEY, JSON.stringify(counts), ttlSeconds);
      return counts;
    },

    async getDriverTierCounts() {
      const cached = await cache.get(TIER_KEY);
      if (cached) {
        return JSON.parse(cached) as Awaited<ReturnType<AnalyticsReader['getDriverTierCounts']>>;
      }

      const counts = await reader.getDriverTierCounts();
      await cache.set(TIER_KEY, JSON.stringify(counts), ttlSeconds);
      return counts;
    },
  };
}
