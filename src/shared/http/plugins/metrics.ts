import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { httpRequestDuration, httpRequestsTotal } from '../../metrics/index.js';

/**
 * Records every request's duration/count, labeled by route *pattern*
 * (`request.routeOptions.url`, e.g. `/api/v1/deliveries/:chainDeliveryId`)
 * rather than the raw URL — using the raw URL would blow up label
 * cardinality with one time series per distinct id ever requested.
 * Requests that don't match any route (`routeOptions.url` is `undefined`
 * for a 404) are labeled `unmatched` rather than dropped, so a spike in
 * 404s is still visible.
 */
export default fp(async function metricsPlugin(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
  });
});
