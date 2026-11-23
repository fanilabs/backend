import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsRoutes } from './routes.js';

vi.mock('../../../shared/http/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/http/index.js')>();
  return {
    ...actual,
    authenticate: vi.fn(async (_req: unknown, _reply: unknown) => {}),
    requireRole: () => vi.fn(async (_req: unknown, _reply: unknown) => {}),
  };
});

function buildMockUseCases() {
  return {
    getGmv: vi.fn().mockResolvedValue([]),
    getCompletionRate: vi
      .fn()
      .mockResolvedValue({ totalDeliveries: 0, deliveredCount: 0, completionRate: 0 }),
    getDisputeRate: vi
      .fn()
      .mockResolvedValue({ totalDeliveries: 0, disputedCount: 0, disputeRate: 0 }),
    getDriverTierDistribution: vi
      .fn()
      .mockResolvedValue({ bronze: 0, silver: 0, gold: 0, total: 0 }),
  };
}

async function buildTestApp() {
  const useCases = buildMockUseCases();
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createAnalyticsRoutes(useCases), { prefix: '/api/v1' });
  return { app, useCases };
}

describe('analytics routes — HEAD', () => {
  it('HEAD /analytics/gmv returns 200 with empty body', async () => {
    const { app, useCases } = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'HEAD', url: '/api/v1/analytics/gmv' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(useCases.getGmv).toHaveBeenCalledTimes(1);
  });

  it('HEAD /analytics/gmv Cache-Control header matches GET', async () => {
    const { app } = await buildTestApp();
    await app.ready();

    const getResponse = await app.inject({ method: 'GET', url: '/api/v1/analytics/gmv' });
    const headResponse = await app.inject({ method: 'HEAD', url: '/api/v1/analytics/gmv' });

    expect(headResponse.statusCode).toBe(200);
    expect(headResponse.body).toBe('');
    expect(headResponse.headers['cache-control']).toBeDefined();
    expect(headResponse.headers['cache-control']).toBe(getResponse.headers['cache-control']);
  });

  it('HEAD /analytics/completion-rate returns 200 with empty body', async () => {
    const { app } = await buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'HEAD',
      url: '/api/v1/analytics/completion-rate',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('HEAD /analytics/dispute-rate returns 200 with empty body', async () => {
    const { app } = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'HEAD', url: '/api/v1/analytics/dispute-rate' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('HEAD /analytics/driver-tiers returns 200 with empty body', async () => {
    const { app } = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'HEAD', url: '/api/v1/analytics/driver-tiers' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });
});
