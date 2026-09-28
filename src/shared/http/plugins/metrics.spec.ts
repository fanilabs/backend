import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import metricsPlugin from './metrics.js';
import { httpRequestsTotal } from '../../metrics/index.js';

async function buildInstance() {
  const app = Fastify();
  await app.register(metricsPlugin);
  app.get('/api/v1/deliveries/:chainDeliveryId', async () => ({ ok: true }));
  await app.ready();
  return app;
}

/** Sum of the `http_requests_total` counter across every series whose labels
 *  match `match` — the shared process-wide registry accumulates across the
 *  whole suite, so assertions compare a before/after delta rather than an
 *  absolute value. */
async function countMatching(match: Record<string, string>): Promise<number> {
  const metric = await httpRequestsTotal.get();
  return metric.values
    .filter((series) => {
      const labels = series.labels as Record<string, string | number | undefined>;
      return Object.entries(match).every(([label, value]) => labels[label] === value);
    })
    .reduce((sum, series) => sum + series.value, 0);
}

describe('metrics plugin', () => {
  it('labels a parameterized route by its pattern, not the concrete requested URL', async () => {
    const app = await buildInstance();
    const pattern = '/api/v1/deliveries/:chainDeliveryId';
    const before = await countMatching({ route: pattern, status_code: '200' });

    await app.inject({ method: 'GET', url: '/api/v1/deliveries/abc-123' });
    await app.inject({ method: 'GET', url: '/api/v1/deliveries/def-456' });

    expect((await countMatching({ route: pattern, status_code: '200' })) - before).toBe(2);
    // The concrete ids must never each become their own time series.
    expect(await countMatching({ route: '/api/v1/deliveries/abc-123' })).toBe(0);
    expect(await countMatching({ route: '/api/v1/deliveries/def-456' })).toBe(0);

    await app.close();
  });

  it('labels an unmatched request (404) as `unmatched` rather than dropping it', async () => {
    const app = await buildInstance();
    const before = await countMatching({ route: 'unmatched', status_code: '404' });

    await app.inject({ method: 'GET', url: '/nope/not/a/real/route' });

    expect((await countMatching({ route: 'unmatched', status_code: '404' })) - before).toBe(1);

    await app.close();
  });
});
