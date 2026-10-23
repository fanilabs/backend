import { logger } from '../../../shared/logger/index.js';
import type { AnalyticsReader, GmvByToken } from '../domain/index.js';
import type { AnalyticsCache } from './analytics-cache.js';

const log = logger.child({ module: 'cached-analytics-reader' });

const CACHE_KEY_PREFIX = 'analytics:v1:';
const GMV_KEY = `${CACHE_KEY_PREFIX}gmv-by-token`;
const FUNNEL_KEY = `${CACHE_KEY_PREFIX}delivery-funnel-counts`;
const TIER_KEY = `${CACHE_KEY_PREFIX}driver-tier-counts`;

type CachedGmvByToken = Omit<GmvByToken, 'releasedAmount'> & { releasedAmount: string };

async function safeCacheGet<T>(
  cache: AnalyticsCache,
  key: string,
  parse: (raw: string) => T,
): Promise<T | null> {
  try {
    const cached = await cache.get(key);
    if (!cached) return null;
    return parse(cached);
  } catch (err: unknown) {
    log.warn({ err, key }, 'Analytics cache read or parse failed — falling back to reader');
    return null;
  }
}

async function safeCacheSet(
  cache: AnalyticsCache,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    await cache.set(key, value, ttlSeconds);
  } catch (err: unknown) {
    log.warn({ err, key }, 'Analytics cache write failed — continuing with fresh reader result');
  }
}

export function createCachedAnalyticsReader(
  reader: AnalyticsReader,
  cache: AnalyticsCache,
  ttlSeconds: number,
): AnalyticsReader {
  return {
    async getGmvByToken() {
      const hit = await safeCacheGet(cache, GMV_KEY, (raw) => {
        const rows = JSON.parse(raw) as CachedGmvByToken[];
        return rows.map((row) => ({ ...row, releasedAmount: BigInt(row.releasedAmount) }));
      });
      if (hit) return hit;

      const rows = await reader.getGmvByToken();
      const serializable: CachedGmvByToken[] = rows.map((row) => ({
        ...row,
        releasedAmount: row.releasedAmount.toString(),
      }));
      await safeCacheSet(cache, GMV_KEY, JSON.stringify(serializable), ttlSeconds);
      return rows;
    },

    async getDeliveryFunnelCounts() {
      const hit = await safeCacheGet(
        cache,
        FUNNEL_KEY,
        (raw) => JSON.parse(raw) as Awaited<ReturnType<AnalyticsReader['getDeliveryFunnelCounts']>>,
      );
      if (hit) return hit;

      const counts = await reader.getDeliveryFunnelCounts();
      await safeCacheSet(cache, FUNNEL_KEY, JSON.stringify(counts), ttlSeconds);
      return counts;
    },

    async getDriverTierCounts() {
      const hit = await safeCacheGet(
        cache,
        TIER_KEY,
        (raw) => JSON.parse(raw) as Awaited<ReturnType<AnalyticsReader['getDriverTierCounts']>>,
      );
      if (hit) return hit;

      const counts = await reader.getDriverTierCounts();
      await safeCacheSet(cache, TIER_KEY, JSON.stringify(counts), ttlSeconds);
      return counts;
    },
  };
}
