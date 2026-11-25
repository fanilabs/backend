import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { createReputationRoutes } from './routes.js';

vi.mock('../../../shared/http/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/http/index.js')>();
  return {
    ...actual,
    authenticate: vi.fn(async (_req: unknown, _reply: unknown) => {}),
    requireRole: () => vi.fn(async (_req: unknown, _reply: unknown) => {}),
  };
});

function buildTestApp() {
  const getDriverProfile = vi.fn().mockResolvedValue({
    id: 'test-id',
    address: 'G' + 'A'.repeat(55),
    reputationScore: 50,
    tier: 'BRONZE',
    kycVerified: false,
    deliveriesCompleted: 0,
    legacyDeliveriesCompleted: 0,
    registeredAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const buildTransactions = {
    buildRegisterDriverTransaction: vi.fn(),
    buildUpdateDriverKycStatusTransaction: vi.fn(),
  };
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(createReputationRoutes({ getDriverProfile, buildTransactions }), {
    prefix: '/api/v1',
  });
  return { app, getDriverProfile };
}

describe('reputation routes — HEAD', () => {
  it('HEAD /drivers/:address/reputation returns 200 with empty body', async () => {
    const { app, getDriverProfile } = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'HEAD',
      url: '/api/v1/drivers/' + 'G' + 'A'.repeat(55) + '/reputation',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(getDriverProfile).toHaveBeenCalledTimes(1);
  });

  it('HEAD /drivers/:address/reputation preserves 404 for missing driver', async () => {
    const { NotFoundError } = await import('../../../shared/errors/index.js');
    const getDriverProfile = vi.fn().mockRejectedValue(new NotFoundError('driver not found'));
    const buildTransactions = {
      buildRegisterDriverTransaction: vi.fn(),
      buildUpdateDriverKycStatusTransaction: vi.fn(),
    };
    const app2 = Fastify();
    app2.setValidatorCompiler(validatorCompiler);
    app2.setSerializerCompiler(serializerCompiler);
    // Wire the error handler so NotFoundError maps to 404
    const { handleError } = await import('../../../shared/errors/index.js');
    app2.setErrorHandler(handleError);
    app2.register(createReputationRoutes({ getDriverProfile, buildTransactions }), {
      prefix: '/api/v1',
    });
    await app2.ready();

    const response = await app2.inject({
      method: 'HEAD',
      url: '/api/v1/drivers/' + 'G' + 'A'.repeat(55) + '/reputation',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('');
  });
});
