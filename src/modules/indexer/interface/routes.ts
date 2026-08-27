import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { createGetIndexerHealthUseCase, TrackedContract } from '../application/index.js';
import { indexerHealthResponseSchema } from './schemas.js';

export interface IndexerRoutesDeps {
  getIndexerHealth: ReturnType<typeof createGetIndexerHealthUseCase>;
  trackedContracts: TrackedContract[];
  network: string;
  lagAlertThreshold: number;
}

/**
 * Deliberately outside `/api/v1` and unauthenticated, matching the
 * top-level `/health` convention (src/shared/http/routes/health.ts) — this
 * is an operational probe, not a business API endpoint.
 */
export function createIndexerHealthRoutes(deps: IndexerRoutesDeps): FastifyPluginAsyncZod {
  return async function indexerHealthRoutes(app) {
    app.get(
      '/health/indexer',
      {
        schema: {
          response: { 200: indexerHealthResponseSchema, 503: indexerHealthResponseSchema },
        },
      },
      async (_request, reply) => {
        const result = await deps.getIndexerHealth({
          network: deps.network,
          trackedContracts: deps.trackedContracts,
          lagAlertThreshold: deps.lagAlertThreshold,
        });

        const body = {
          status: result.healthy ? ('ok' as const) : ('degraded' as const),
          latestLedger: result.latestLedger,
          contracts: result.contracts,
        };

        void reply.status(result.healthy ? 200 : 503).send(body);
      },
    );
  };
}
