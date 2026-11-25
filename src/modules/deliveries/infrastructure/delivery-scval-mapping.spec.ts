import { describe, expect, it } from 'vitest';
import type { CargoCategory, DeliveryStatus } from '@prisma/client';
import { nativeToChainDeliveryRecord } from './delivery-scval-mapping.js';

/**
 * Regression contract for the delivery decoder's enum matrix (#616).
 *
 * `nativeToChainDeliveryRecord` consumes the native (post-`scValToNative`)
 * shape of a `get_delivery` return value. Unit enums decode as a
 * one-element Vec wrapping a Symbol string, and `DeliveryId` decodes as a
 * one-element Vec wrapping a u64-as-string. These fixtures are minimal valid
 * records built by hand — no live network calls, fully deterministic.
 */

const DELIVERY_STATUS_CASES: ReadonlyArray<[string, DeliveryStatus]> = [
  ['Pending', 'PENDING'],
  ['Active', 'ACTIVE'],
  ['InTransit', 'IN_TRANSIT'],
  ['Delivered', 'DELIVERED'],
  ['Disputed', 'DISPUTED'],
  ['Cancelled', 'CANCELLED'],
];

const CARGO_CATEGORY_CASES: ReadonlyArray<[string, CargoCategory]> = [
  ['Documents', 'DOCUMENTS'],
  ['Electronics', 'ELECTRONICS'],
  ['Perishables', 'PERISHABLES'],
  ['Clothing', 'CLOTHING'],
  ['General', 'GENERAL'],
];

function unitEnum(variant: string): unknown[] {
  return [variant];
}

function buildRecord(overrides: {
  status?: unknown;
  category?: unknown;
  driver?: unknown;
  estimatedDelivery?: unknown;
  deliveredAt?: unknown;
} = {}): Record<string, unknown> {
  return {
    delivery_id: ['42'],
    sender: 'GSENDER',
    recipient: 'GRECIPIENT',
    driver: 'driver' in overrides ? overrides.driver : null,
    status: 'status' in overrides ? overrides.status : unitEnum('Pending'),
    metadata: {
      origin: 'Lagos',
      destination: 'Abuja',
      cargo_description: {
        weight_grams: 1000,
        category: 'category' in overrides ? overrides.category : unitEnum('General'),
        fragile: false,
      },
      created_at: '1700000000',
      estimated_delivery:
        'estimatedDelivery' in overrides ? overrides.estimatedDelivery : '1700003600',
    },
    delivered_at: 'deliveredAt' in overrides ? overrides.deliveredAt : null,
  };
}

describe('nativeToChainDeliveryRecord — delivery status enum matrix', () => {
  it.each(DELIVERY_STATUS_CASES)(
    'maps Rust status %s to %s',
    (variant, expected) => {
      const record = nativeToChainDeliveryRecord(buildRecord({ status: unitEnum(variant) }));
      expect(record.status).toBe(expected);
    },
  );

  it('throws on an unknown delivery status variant', () => {
    expect(() =>
      nativeToChainDeliveryRecord(buildRecord({ status: unitEnum('Teleported') })),
    ).toThrow(/Unknown DeliveryStatus variant: Teleported/);
  });
});

describe('nativeToChainDeliveryRecord — cargo category enum matrix', () => {
  it.each(CARGO_CATEGORY_CASES)(
    'maps Rust cargo category %s to %s',
    (variant, expected) => {
      const record = nativeToChainDeliveryRecord(buildRecord({ category: unitEnum(variant) }));
      expect(record.cargoCategory).toBe(expected);
    },
  );

  it('throws on an unknown cargo category variant', () => {
    expect(() =>
      nativeToChainDeliveryRecord(buildRecord({ category: unitEnum('Unobtainium') })),
    ).toThrow(/Unknown CargoCategory variant: Unobtainium/);
  });
});

describe('nativeToChainDeliveryRecord — nullable driver and optional timestamps', () => {
  it('decodes a null driver as null', () => {
    const record = nativeToChainDeliveryRecord(buildRecord({ driver: null }));
    expect(record.driverAddress).toBeNull();
  });

  it('decodes a present driver address', () => {
    const record = nativeToChainDeliveryRecord(buildRecord({ driver: 'GDRIVER' }));
    expect(record.driverAddress).toBe('GDRIVER');
  });

  it('decodes a null estimated_delivery as null', () => {
    const record = nativeToChainDeliveryRecord(buildRecord({ estimatedDelivery: null }));
    expect(record.estimatedDelivery).toBeNull();
  });

  it('decodes a null delivered_at as null', () => {
    const record = nativeToChainDeliveryRecord(buildRecord({ deliveredAt: null }));
    expect(record.deliveredAt).toBeNull();
  });

  it('decodes a present delivered_at timestamp', () => {
    const record = nativeToChainDeliveryRecord(buildRecord({ deliveredAt: '1700007200' }));
    expect(record.deliveredAt).toEqual(new Date(1700007200 * 1000));
  });
});
