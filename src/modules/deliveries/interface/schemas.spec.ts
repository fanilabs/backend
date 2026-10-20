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

describe('createDeliveryBodySchema future estimatedDelivery (#440)', () => {
  it('rejects past timestamps and accepts future timestamps', () => {
    const base = {
      senderAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
      recipientAddress: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR',
      origin: 'Lagos',
      destination: 'Abuja',
      cargoCategory: 'ELECTRONICS',
      weightGrams: 500,
      fragile: true,
    };
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(createDeliveryBodySchema.safeParse({ ...base, estimatedDelivery: past }).success).toBe(false);
    expect(createDeliveryBodySchema.safeParse({ ...base, estimatedDelivery: future }).success).toBe(true);
  });
});
