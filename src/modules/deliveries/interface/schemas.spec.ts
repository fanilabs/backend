import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createDeliveryBodySchema, getDeliveryResponseSchema } from './schemas.js';

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

describe('POST /transactions/build/confirm-delivery preHandler consistency (#452)', () => {
  it('registers preHandler: authenticate instead of onRequest', async () => {
    const { createDeliveriesRoutes } = await import('./routes.js');
    const registered: Array<{ method: string; url: string; opts: Record<string, unknown> }> = [];
    const fakeApp = {
      get: (url: string, opts: Record<string, unknown>) => registered.push({ method: 'GET', url, opts }),
      post: (url: string, opts: Record<string, unknown>) => registered.push({ method: 'POST', url, opts }),
    };
    const plugin = createDeliveriesRoutes({} as never);
    await (plugin as unknown as (app: unknown) => Promise<void>)(fakeApp);
    const confirmRoute = registered.find((r) => r.url === '/transactions/build/confirm-delivery');
    expect(confirmRoute?.opts.onRequest).toBeUndefined();
    expect(confirmRoute?.opts.preHandler).toBeDefined();
  });
});
