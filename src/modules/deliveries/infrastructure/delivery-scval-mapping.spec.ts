import { Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  addressToScVal,
  boolToScVal,
  namedStructToScVal,
  scValToNative,
  stringToScVal,
  tupleStructToScVal,
  u32ToScVal,
  u64ToScVal,
  unitEnumToScVal,
} from '../../../blockchain/xdr/sc-val.js';
import {
  createDeliveryArgsToScVal,
  deliveryIdToScVal,
  nativeToChainDeliveryRecord,
} from './delivery-scval-mapping.js';

describe('deliveryIdToScVal', () => {
  it('encodes as a one-element Vec (tuple struct), matching DeliveryId(pub u64)', () => {
    const scVal = deliveryIdToScVal(42n);
    expect(scVal.switch().name).toBe('scvVec');
    expect(scValToNative(scVal)).toEqual(['42']);
  });
});

describe('createDeliveryArgsToScVal', () => {
  it('produces [sender, recipient, metadata] with the DeliveryMetadata struct fields sorted', () => {
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();

    const estimatedDelivery = new Date('2026-06-01T00:00:00Z');
    const args = createDeliveryArgsToScVal({
      senderAddress: sender,
      recipientAddress: recipient,
      origin: 'Lagos',
      destination: 'Accra',
      cargoCategory: 'ELECTRONICS',
      weightGrams: 750,
      fragile: true,
      estimatedDelivery,
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[0]!)).toBe(sender);
    expect(scValToNative(args[1]!)).toBe(recipient);

    const metadata = scValToNative(args[2]!) as Record<string, unknown>;
    expect(metadata.origin).toBe('Lagos');
    expect(metadata.destination).toBe('Accra');
    expect(metadata.cargo_description).toEqual({
      category: ['Electronics'],
      fragile: true,
      weight_grams: 750,
    });
    expect(metadata.estimated_delivery).toBe(
      String(Math.floor(estimatedDelivery.getTime() / 1000)),
    );
  });
});

/** Hand-builds a `get_delivery`-shaped ScVal using the same low-level
 * encoders `delivery-scval-mapping.ts` decodes against — the strongest
 * available verification without a live contract (see that file's header
 * comment). */
function buildDeliveryRecordScVal(input: {
  chainDeliveryId: bigint;
  sender: string;
  recipient: string;
  driver: string | null;
  status: string;
  origin: string;
  destination: string;
  weightGrams: number;
  category: string;
  fragile: boolean;
  createdAt: bigint;
  transitStartedAt: bigint | null;
  deliveredAt: bigint | null;
}): xdr.ScVal {
  const metadata = namedStructToScVal({
    delivery_id: u64ToScVal(0n),
    origin: stringToScVal(input.origin),
    destination: stringToScVal(input.destination),
    cargo_description: namedStructToScVal({
      weight_grams: u32ToScVal(input.weightGrams),
      category: unitEnumToScVal(input.category),
      fragile: boolToScVal(input.fragile),
    }),
    created_at: u64ToScVal(input.createdAt),
    estimated_delivery: u64ToScVal(input.createdAt + 86_400n),
  });

  return namedStructToScVal({
    delivery_id: tupleStructToScVal(u64ToScVal(input.chainDeliveryId)),
    sender: addressToScVal(input.sender),
    recipient: addressToScVal(input.recipient),
    driver: input.driver ? addressToScVal(input.driver) : xdr.ScVal.scvVoid(),
    status: unitEnumToScVal(input.status),
    metadata,
    created_at: u64ToScVal(input.createdAt),
    delivered_at: input.deliveredAt !== null ? u64ToScVal(input.deliveredAt) : xdr.ScVal.scvVoid(),
    transit_started_at:
      input.transitStartedAt !== null ? u64ToScVal(input.transitStartedAt) : xdr.ScVal.scvVoid(),
  });
}

describe('nativeToChainDeliveryRecord', () => {
  it('decodes a full DeliveryRecord (Pending, no driver, no timestamps)', () => {
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const scVal = buildDeliveryRecordScVal({
      chainDeliveryId: 7n,
      sender,
      recipient,
      driver: null,
      status: 'Pending',
      origin: 'Nairobi',
      destination: 'Kampala',
      weightGrams: 300,
      category: 'Documents',
      fragile: false,
      createdAt: 1_700_000_000n,
      transitStartedAt: null,
      deliveredAt: null,
    });

    const record = nativeToChainDeliveryRecord(scValToNative(scVal));

    expect(record).toEqual({
      chainDeliveryId: 7n,
      senderAddress: sender,
      recipientAddress: recipient,
      driverAddress: null,
      status: 'PENDING',
      origin: 'Nairobi',
      destination: 'Kampala',
      cargoCategory: 'DOCUMENTS',
      weightGrams: 300,
      fragile: false,
      createdAtChain: new Date(1_700_000_000 * 1000),
      transitStartedAt: null,
      deliveredAt: null,
    });
  });

  it('decodes a Delivered record with driver and timestamps present', () => {
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const scVal = buildDeliveryRecordScVal({
      chainDeliveryId: 12n,
      sender,
      recipient,
      driver,
      status: 'Delivered',
      origin: 'Accra',
      destination: 'Lagos',
      weightGrams: 5200,
      category: 'Perishables',
      fragile: true,
      createdAt: 1_700_000_000n,
      transitStartedAt: 1_700_050_000n,
      deliveredAt: 1_700_100_000n,
    });

    const record = nativeToChainDeliveryRecord(scValToNative(scVal));

    expect(record.driverAddress).toBe(driver);
    expect(record.status).toBe('DELIVERED');
    expect(record.cargoCategory).toBe('PERISHABLES');
    expect(record.transitStartedAt).toEqual(new Date(1_700_050_000 * 1000));
    expect(record.deliveredAt).toEqual(new Date(1_700_100_000 * 1000));
  });

  it('throws on a structurally invalid record rather than returning partial data', () => {
    expect(() => nativeToChainDeliveryRecord({ not: 'a delivery record' })).toThrow();
  });
});
