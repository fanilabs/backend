import { describe, expect, it } from 'vitest';
import type { Delivery } from './entities.js';
import { serializeDelivery } from './serialization.js';

function buildDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-1',
    chainDeliveryId: 42n,
    senderAddress: '0xsender',
    recipientAddress: '0xrecipient',
    driverAddress: '0xdriver',
    status: 'IN_TRANSIT',
    origin: 'Origin',
    destination: 'Destination',
    cargoCategory: 'GENERAL',
    weightGrams: 1000,
    fragile: false,
    createdAtChain: new Date('2024-01-01T00:00:00.000Z'),
    transitStartedAt: new Date('2024-01-02T00:00:00.000Z'),
    deliveredAt: null,
    ...overrides,
  };
}

describe('serializeDelivery', () => {
  it('serializes an assigned delivery with transitStartedAt present and deliveredAt null', () => {
    const delivery = buildDelivery();

    const serialized = serializeDelivery(delivery);

    expect(serialized.transitStartedAt).toBe('2024-01-02T00:00:00.000Z');
    expect(serialized.deliveredAt).toBeNull();
  });

  it('keeps null driver and timestamps as explicit nulls for a pending delivery', () => {
    const delivery = buildDelivery({
      driverAddress: null,
      status: 'PENDING',
      transitStartedAt: null,
      deliveredAt: null,
    });

    const serialized = serializeDelivery(delivery);

    expect(serialized.driverAddress).toBeNull();
    expect(serialized.transitStartedAt).toBeNull();
    expect(serialized.deliveredAt).toBeNull();
    expect('driverAddress' in serialized).toBe(true);
    expect('transitStartedAt' in serialized).toBe(true);
    expect('deliveredAt' in serialized).toBe(true);
  });

  it('serializes a populated deliveredAt as an ISO UTC string', () => {
    const deliveredAt = new Date('2024-03-05T12:34:56.789Z');
    const delivery = buildDelivery({
      status: 'DELIVERED',
      transitStartedAt: new Date('2024-03-04T08:00:00.000Z'),
      deliveredAt,
    });

    const serialized = serializeDelivery(delivery);

    expect(serialized.deliveredAt).toBe(deliveredAt.toISOString());
    expect(serialized.deliveredAt).toBe('2024-03-05T12:34:56.789Z');
  });

  it('passes non-converted fields through unchanged and does not mutate inputs', () => {
    const createdAtChain = new Date('2024-01-01T00:00:00.000Z');
    const transitStartedAt = new Date('2024-01-02T00:00:00.000Z');
    const deliveredAt = new Date('2024-01-03T00:00:00.000Z');
    const chainDeliveryId = 42n;
    const delivery = buildDelivery({
      chainDeliveryId,
      createdAtChain,
      transitStartedAt,
      deliveredAt,
    });

    const serialized = serializeDelivery(delivery);

    expect(serialized.id).toBe(delivery.id);
    expect(serialized.senderAddress).toBe(delivery.senderAddress);
    expect(serialized.recipientAddress).toBe(delivery.recipientAddress);
    expect(serialized.driverAddress).toBe(delivery.driverAddress);
    expect(serialized.status).toBe(delivery.status);
    expect(serialized.origin).toBe(delivery.origin);
    expect(serialized.destination).toBe(delivery.destination);
    expect(serialized.cargoCategory).toBe(delivery.cargoCategory);
    expect(serialized.weightGrams).toBe(delivery.weightGrams);
    expect(serialized.fragile).toBe(delivery.fragile);
    expect(serialized.chainDeliveryId).toBe('42');

    expect(delivery.chainDeliveryId).toBe(chainDeliveryId);
    expect(delivery.createdAtChain).toBe(createdAtChain);
    expect(delivery.transitStartedAt).toBe(transitStartedAt);
    expect(delivery.deliveredAt).toBe(deliveredAt);
    expect(createdAtChain.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(transitStartedAt.toISOString()).toBe('2024-01-02T00:00:00.000Z');
    expect(deliveredAt.toISOString()).toBe('2024-01-03T00:00:00.000Z');
  });
});
