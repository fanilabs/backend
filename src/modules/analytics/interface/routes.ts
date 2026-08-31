import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getConfig } from '../../../shared/config/index.js';
import { authenticate, ok, requireRole } from '../../../shared/http/index.js';
import type {
  createGetCompletionRateUseCase,
  createGetDisputeRateUseCase,
  createGetDriverTierDistributionUseCase,
  createGetGmvUseCase,
} from '../application/index.js';
import {
  completionRateResponseSchema,
  disputeRateResponseSchema,
  driverTierDistributionResponseSchema,
  gmvResponseSchema,
} from './schemas.js';

export interface AnalyticsUseCases {
  getGmv: ReturnType<typeof createGetGmvUseCase>;
  getCompletionRate: ReturnType<typeof createGetCompletionRateUseCase>;
  getDisputeRate: ReturnType<typeof createGetDisputeRateUseCase>;
  getDriverTierDistribution: ReturnType<typeof createGetDriverTierDistributionUseCase>;
}

/**
 * Every route here is gated to `ADMIN` — unlike other modules' single-
 * resource `GET`s (which mirror public on-chain state, "like a block
 * explorer" per `API_REFERENCE.md`), these are value-added aggregate
 * business metrics this backend computes, not a mirror of any single
 * public on-chain fact, and GMV/dispute-rate in particular are the kind
 * of platform-revenue-adjacent numbers a real deployment wouldn't want
 * publicly exposed.
 */
const adminOnly = [authenticate, requireRole('ADMIN')];

export function createAnalyticsRoutes(useCases: AnalyticsUseCases): FastifyPluginAsyncZod {
  /**
   * Mirrors the read-through cache TTL in the infrastructure layer
   * (`infrastructure/cached-analytics-reader.ts`) so an admin dashboard can
   * also cache these responses client-side instead of re-fetching on every
   * render within the same staleness window. `private` — these are
   * `ADMIN`-gated business metrics, never meant for a shared/proxy cache.
   * Computed lazily (not at module load) so config parsing stays lazy too.
   */
  const cacheControlHeader = `private, max-age=${getConfig().ANALYTICS_CACHE_TTL_SECONDS}`;

  return async function analyticsRoutes(app) {
    app.get(
      '/analytics/gmv',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          response: { 200: gmvResponseSchema },
        },
      },
      async (_request, reply) => {
        const rows = await useCases.getGmv();
        void reply
          .header('Cache-Control', cacheControlHeader)
          .status(200)
          .send(
            ok(
              rows.map((row) => ({
                token: row.token,
                releasedAmount: row.releasedAmount.toString(),
                releasedCount: row.releasedCount,
              })),
            ),
          );
      },
    );

    app.get(
      '/analytics/completion-rate',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          response: { 200: completionRateResponseSchema },
        },
      },
      async (_request, reply) => {
        void reply
          .header('Cache-Control', cacheControlHeader)
          .status(200)
          .send(ok(await useCases.getCompletionRate()));
      },
    );

    app.get(
      '/analytics/dispute-rate',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          response: { 200: disputeRateResponseSchema },
        },
      },
      async (_request, reply) => {
        void reply
          .header('Cache-Control', cacheControlHeader)
          .status(200)
          .send(ok(await useCases.getDisputeRate()));
      },
    );

    app.get(
      '/analytics/driver-tiers',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          response: { 200: driverTierDistributionResponseSchema },
        },
      },
      async (_request, reply) => {
        void reply
          .header('Cache-Control', cacheControlHeader)
          .status(200)
          .send(ok(await useCases.getDriverTierDistribution()));
      },
    );
  };
}
