import { describe, expect, it } from 'vitest';
import { getDeliveryResponseSchema } from './schemas.js';

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
