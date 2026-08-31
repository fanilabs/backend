import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getRedisClient } from '../../shared/cache/index.js';
import {
  createGetCompletionRateUseCase,
  createGetDisputeRateUseCase,
  createGetDriverTierDistributionUseCase,
  createGetGmvUseCase,
} from './application/index.js';
import {
  createCachedAnalyticsReader,
  createPrismaAnalyticsReader,
  createRedisAnalyticsCache,
} from './infrastructure/index.js';
import { createAnalyticsRoutes } from './interface/routes.js';

/** No blockchain-event subscription here, unlike every other module —
 * `analytics` has nothing to write, only read models built by other
 * modules' handlers to aggregate over on request. Nothing for
 * `src/workers/index.ts` to wire either, for the same reason. */
export function createAnalyticsModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const analyticsReader = createCachedAnalyticsReader(
    createPrismaAnalyticsReader(prisma),
    createRedisAnalyticsCache(getRedisClient()),
    getConfig().ANALYTICS_CACHE_TTL_SECONDS,
  );

  const useCases = {
    getGmv: createGetGmvUseCase({ analyticsReader }),
    getCompletionRate: createGetCompletionRateUseCase({ analyticsReader }),
    getDisputeRate: createGetDisputeRateUseCase({ analyticsReader }),
    getDriverTierDistribution: createGetDriverTierDistributionUseCase({ analyticsReader }),
  };

  return createAnalyticsRoutes(useCases);
}
