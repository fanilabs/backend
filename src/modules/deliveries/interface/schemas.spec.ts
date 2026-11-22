import { Keypair } from '@stellar/stellar-sdk';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { createDeliveryBodySchema, getDeliveryResponseSchema, listDeliveriesQuerySchema } from './schemas.js';
import { createDeliveriesRoutes } from './routes.js';

vi.mock('../../../shared/http/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/http/index.js')>();
  return {
    ...actual,
    authenticate: vi.fn(async () => {}),
    requireRole: () => vi.fn(async () => {}),
  };
});

function deliveryDto(destination: string) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainDeliveryId: '1',
    senderAddress: 'GSENDER',
    recipientAddress: 'GRECIPIENT',
    driverAddress: null,
    status: 'PENDING',
    origin: 'Lagos',
    destination,
    cargoCategory: 'GENERAL',
    weightGrams: 500,
    fragile: false,
    createdAtChain: '2026-01-01T00:00:00.000Z',
    transitStartedAt: null,
    deliveredAt: null,
  };
}

describe('delivery response schemas', () => {
  it('accepts a destination at the maximum length', () => {
    const result = getDeliveryResponseSchema.safeParse({ data: deliveryDto('a'.repeat(256)) });

    expect(result.success).toBe(true);
  });

  it('rejects a destination longer than the maximum length', () => {
    const result = getDeliveryResponseSchema.safeParse({ data: deliveryDto('a'.repeat(257)) });

    expect(result.success).toBe(false);
  });
});

describe('createDeliveryBodySchema (issue #377)', () => {
  const senderAddress = Keypair.random().publicKey();
  const recipientAddress = Keypair.random().publicKey();

  function validCreateBody(overrides: Record<string, unknown> = {}) {
    return {
      senderAddress,
      recipientAddress,
      origin: 'Lagos Warehouse',
      destination: 'Abuja Depot',
      cargoCategory: 'GENERAL',
      weightGrams: 500,
      fragile: false,
      estimatedDelivery: '2026-12-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('accepts a valid payload with distinct origin/destination and parties', () => {
    expect(createDeliveryBodySchema.safeParse(validCreateBody()).success).toBe(true);
  });

  it('rejects identical origin and destination', () => {
    const result = createDeliveryBodySchema.safeParse(
      validCreateBody({ origin: 'Warehouse A', destination: 'Warehouse A' }),
    );

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error.issues[0]).toMatchObject({
        path: ['destination'],
        message: 'Destination must differ from origin',
      });
    }
  });

  it('rejects origin/destination that differ only by case and surrounding whitespace', () => {
    const result = createDeliveryBodySchema.safeParse(
      validCreateBody({ origin: 'Warehouse A', destination: '  warehouse a ' }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects identical sender and recipient addresses', () => {
    const result = createDeliveryBodySchema.safeParse(
      validCreateBody({ recipientAddress: senderAddress }),
    );

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error.issues[0]).toMatchObject({
        path: ['recipientAddress'],
        message: 'Recipient address must differ from sender address',
      });
    }
  });
});

describe('listDeliveriesQuerySchema', () => {
  const validStatuses = ['PENDING', 'ACTIVE', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'CANCELLED'];
  const validAddress = 'G' + 'A'.repeat(55);

  it.each(validStatuses)('accepts status=%s', (status) => {
    expect(listDeliveriesQuerySchema.safeParse({ status }).success).toBe(true);
  });

  it('accepts empty query (all filters optional)', () => {
    expect(listDeliveriesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts combined valid filters', () => {
    expect(
      listDeliveriesQuerySchema.safeParse({
        senderAddress: validAddress,
        status: 'PENDING',
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid status value', () => {
    const result = listDeliveriesQuerySchema.safeParse({ status: 'INVALID_STATUS' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string senderAddress (number)', () => {
    const result = listDeliveriesQuerySchema.safeParse({ senderAddress: 12345 });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed senderAddress', () => {
    const result = listDeliveriesQuerySchema.safeParse({ senderAddress: 'not-a-stellar-key' });
    expect(result.success).toBe(false);
  });
});

describe('GET /deliveries query validation via route', () => {
  async function buildTestApp() {
    const listDeliveries = vi.fn().mockResolvedValue([]);
    const getDelivery = vi.fn();
    const buildTransactions = {
      buildCreateDeliveryTransaction: vi.fn(),
      buildAssignDriverTransaction: vi.fn(),
      buildMarkInTransitTransaction: vi.fn(),
      buildConfirmDeliveryTransaction: vi.fn(),
      buildCancelDeliveryTransaction: vi.fn(),
      buildRaiseDisputeTransaction: vi.fn(),
    };
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(
      createDeliveriesRoutes({ listDeliveries, getDelivery, buildTransactions }),
      { prefix: '/api/v1' },
    );
    return { app, listDeliveries };
  }

  it('passes valid filters to the use case unchanged', async () => {
    const { app, listDeliveries } = await buildTestApp();
    const validAddress = 'G' + 'A'.repeat(55);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deliveries?senderAddress=${validAddress}&status=PENDING`,
    });

    expect(response.statusCode).toBe(200);
    expect(listDeliveries).toHaveBeenCalledOnce();
    expect(listDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ senderAddress: validAddress, status: 'PENDING' }),
    );
  });

  it('rejects an invalid status and never calls the use case', async () => {
    const { app, listDeliveries } = await buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries?status=BOGUS',
    });

    expect(response.statusCode).toBe(400);
    expect(listDeliveries).not.toHaveBeenCalled();
  });

  it('rejects a malformed senderAddress and never calls the use case', async () => {
    const { app, listDeliveries } = await buildTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries?senderAddress=not-valid',
    });

    expect(response.statusCode).toBe(400);
    expect(listDeliveries).not.toHaveBeenCalled();
  });
});
