import Fastify from 'fastify';
import { Gauge } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import { createMetricsRoutes } from './metrics.js';
import { registry } from '../../metrics/index.js';

describe('createMetricsRoutes', () => {
  it('awaits refreshExternalGauges before serializing, so the scrape reflects the just-refreshed value', async () => {
    const gauge = new Gauge({
      name: 'test_only_deferred_refresh_gauge',
      help: 'test-only gauge proving refresh completes before serialization (#677)',
      registers: [registry],
    });
    gauge.set(1); // stale prior sample

    let resolveRefresh: (() => void) | undefined;
    const refreshStarted = vi.fn();
    const refreshExternalGauges = vi.fn(() => {
      refreshStarted();
      return new Promise<void>((resolve) => {
        resolveRefresh = () => {
          gauge.set(42);
          resolve();
        };
      });
    });
    const metricsSpy = vi.spyOn(registry, 'metrics');

    const app = Fastify();
    await app.register(createMetricsRoutes({ refreshExternalGauges }));
    await app.ready();

    const requestPromise = app.inject({ method: 'GET', url: '/metrics' });

    // refreshExternalGauges has started but not yet resolved — serialization
    // must not have run yet.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refreshStarted).toHaveBeenCalledTimes(1);
    expect(metricsSpy).not.toHaveBeenCalled();

    resolveRefresh?.();
    const response = await requestPromise;

    expect(metricsSpy).toHaveBeenCalledTimes(1);
    expect(response.body).toContain('test_only_deferred_refresh_gauge 42');
    expect(response.body).not.toContain('test_only_deferred_refresh_gauge 1');

    metricsSpy.mockRestore();
    registry.removeSingleMetric('test_only_deferred_refresh_gauge');
    await app.close();
  });
});
