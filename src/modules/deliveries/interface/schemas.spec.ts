import { describe, expect, it } from 'vitest';
import { listDeliveriesResponseSchema } from './schemas.js';

describe('delivery response schema', () => {
  const delivery = {
    id: 'b936690e-9b1b-4ddd-8ed9-5803c00f1010',
    chainDeliveryId: '1',
    senderAddress: 'sender',
    recipientAddress: 'r'.repeat(56),
    driverAddress: null,
    status: 'PENDING',
    origin: 'Lagos',
    destination: 'Accra',
    cargoCategory: 'GENERAL',
    weightGrams: 1,
    fragile: false,
    createdAtChain: '2026-09-28T00:00:00.000Z',
    transitStartedAt: null,
    deliveredAt: null,
  };

  it('accepts recipient addresses up to 56 characters', () => {
    expect(listDeliveriesResponseSchema.safeParse({ data: [delivery] }).success).toBe(true);
  });

  it('rejects recipient addresses longer than 56 characters', () => {
    expect(
      listDeliveriesResponseSchema.safeParse({
        data: [{ ...delivery, recipientAddress: 'r'.repeat(57) }],
      }).success,
    ).toBe(false);
  });
});
