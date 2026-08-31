import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../database/index.js';
import { disconnectRedis } from '../../cache/index.js';
import { closeAllQueues, disconnectQueueConnection } from '../../queue/index.js';
import { isDatabaseAvailable } from '../../testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('observability routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await closeAllQueues();
    await Promise.all([disconnectPrisma(), disconnectRedis(), disconnectQueueConnection()]);
  });

  it('GET /health reports database and redis reachability', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok', redis: 'ok' });
  });

  it('GET /health/queue reports per-queue job counts for every monitored queue', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/queue' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      queues: Array<{ name: string; waiting: number; failed: number }>;
    }>();
    expect(body.status).toBe('ok');
    expect(body.queues.map((q) => q.name).sort()).toEqual(
      ['blockchain-indexer', 'notifications'].sort(),
    );
  });

  it('GET /metrics returns Prometheus-format text including HTTP and queue series', async () => {
    // A request first, so http_requests_total has at least one real
    // series to assert on below. queue_jobs is always set for every
    // monitored queue on each scrape (queue-health.ts) regardless of
    // whether any job has ever run; indexer_lag_ledgers is deliberately
    // NOT asserted here — it's only set for contracts with a configured
    // id (registry.ts's header comment), and this test env has none.
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('http_requests_total');
    expect(response.body).toContain('http_request_duration_seconds');
    expect(response.body).toContain('queue_jobs');
    expect(response.body).toContain('process_cpu_user_seconds_total');
  });

  it('GET /metrics is unauthenticated', async () => {
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
  });
});
