import type { FastifyPluginAsync } from 'fastify';
import { registry } from '../../metrics/index.js';

export interface MetricsRoutesDeps {
  /** Populates the indexer-lag/queue-depth gauges with fresh values right
   * before this scrape — injected from `app.ts` (the one place allowed to
   * see both `shared` and specific modules), so this file itself never
   * imports from `modules/*`. See `shared/metrics/registry.ts`'s header
   * comment for why the gauges can't just self-update via a `collect`
   * callback instead. */
  refreshExternalGauges: () => Promise<void>;
}

/**
 * Deliberately outside `/api/v1` and unauthenticated, matching the
 * `/health*` convention — an operational/scrape endpoint, not a business
 * API route. A real deployment puts this behind network policy (Prometheus
 * scraping, not a public client), not app-level auth (`OBSERVABILITY.md`).
 */
export function createMetricsRoutes(deps: MetricsRoutesDeps): FastifyPluginAsync {
  return async function metricsRoutes(app) {
    app.get('/metrics', async (_request, reply) => {
      await deps.refreshExternalGauges();
      void reply
        .status(200)
        .type(registry.contentType)
        .send(await registry.metrics());
    });
  };
}
