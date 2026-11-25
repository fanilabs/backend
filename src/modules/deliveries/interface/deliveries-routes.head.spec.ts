import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { createDeliveriesRoutes } from './routes.js';

vi.mock('../../../shared/http/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/http/index.js')>();
  return {
    ...actual,
    authenticate: vi.fn(async (_req: unknown, _reply: unknown) => {}),
    requireRole: () => vi.fn(async (_req: unknown, _reply: unknown) => {}),
  };
});

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

const DELIVERY_ENTITY = {
  id: '11111111-1111-1111-1111-111111111111',
  chainDeliveryId: 1n,
  senderAddress: VALID_ADDRESS,
  recipientAddress: VALID_ADDRESS,
  driverAddress: null,
  status: 'PENDING' as const,
  origin: 'Lagos',
  destination: 'Accra',
  cargoCategory: 'GENERAL' as const,
  weightGrams: 500,
  fragile: false,
  createdAtChain: new Date('2024-01-01T00:00:00.000Z'),
  transitStartedAt: null,
  deliveredAt: null,
};

function buildMockUseCases() {
  return {
    listDeliveries: vi.fn().mockResolvedValue([DELIVERY_ENTITY]),
    getDelivery: vi.fn().mockResolvedValue(DELIVERY_ENTITY),
    buildTransactions: {
      buildCreateDeliveryTransaction: vi.fn(),
      buildAssignDriverTransaction: vi.fn(),
      buildMarkInTransitTransaction: vi.fn(),
      buildConfirmDeliveryTransaction: vi.fn(),
      buildCancelDeliveryTransaction: vi.fn(),
      buildRaiseDisputeTransaction: vi.fn(),
    },
  };
}

async function buildTestApp() {
  const useCases = buildMockUseCases();
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createDeliveriesRoutes(useCases), { prefix: '/api/v1' });
  return { app, useCases };
}

describe('deliveries routes — HEAD', () => {
  it('HEAD /deliveries returns 200 with empty body and calls listDeliveries once', async () => {
    const { app, useCases } = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'HEAD', url: '/api/v1/deliveries' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(useCases.listDeliveries).toHaveBeenCalledTimes(1);
  });

  it('HEAD /deliveries/:chainDeliveryId returns 200 with empty body and calls getDelivery once', async () => {
    const { app, useCases } = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'HEAD', url: '/api/v1/deliveries/1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(useCases.getDelivery).toHaveBeenCalledTimes(1);
  });

  it('HEAD /deliveries returns empty body matching GET', async () => {
    const { app } = await buildTestApp();
    await app.ready();

    const getResponse = await app.inject({ method: 'GET', url: '/api/v1/deliveries' });
    const headResponse = await app.inject({ method: 'HEAD', url: '/api/v1/deliveries' });

    expect(getResponse.statusCode).toBe(200);
    expect(headResponse.statusCode).toBe(200);
    expect(headResponse.body).toBe('');
  });
});
