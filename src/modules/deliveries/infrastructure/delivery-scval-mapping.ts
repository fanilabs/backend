import type { CargoCategory, DeliveryStatus } from '@prisma/client';
import type { xdr } from '@stellar/stellar-sdk';
import {
  addressToScVal,
  boolToScVal,
  namedStructToScVal,
  stringToScVal,
  tupleStructToScVal,
  u32ToScVal,
  u64ToScVal,
  unitEnumToScVal,
} from '../../../blockchain/xdr/sc-val.js';
import type { ChainDeliveryRecord, CreateDeliveryTxInput } from '../domain/index.js';

/**
 * ScVal encoding/decoding specific to `delivery_contract`'s own types
 * (shared_types::DeliveryId/DeliveryMetadata/CargoDescriptor/CargoCategory/
 * DeliveryRecord/DeliveryStatus, per PHASE_1_DOMAIN_ANALYSIS.md §4). Kept
 * separate from the generic `src/blockchain/xdr/sc-val.ts` helpers, which
 * know nothing about any specific contract's types.
 *
 * See src/blockchain/xdr/sc-val.ts's own header comment for the standing
 * caveat: no FaniLab contract is deployed anywhere reachable from this
 * environment, so this mapping is verified by construction (matches the
 * documented Soroban `#[contracttype]` conventions) and by round-tripping
 * through this repo's own encoder/decoder pair, but not yet against a real
 * contract accepting/returning these exact values.
 */

const CARGO_CATEGORY_TO_RUST: Record<CargoCategory, string> = {
  DOCUMENTS: 'Documents',
  ELECTRONICS: 'Electronics',
  PERISHABLES: 'Perishables',
  CLOTHING: 'Clothing',
  GENERAL: 'General',
};

const CARGO_CATEGORY_FROM_RUST: Record<string, CargoCategory> = {
  Documents: 'DOCUMENTS',
  Electronics: 'ELECTRONICS',
  Perishables: 'PERISHABLES',
  Clothing: 'CLOTHING',
  General: 'GENERAL',
};

const DELIVERY_STATUS_FROM_RUST: Record<string, DeliveryStatus> = {
  Pending: 'PENDING',
  Active: 'ACTIVE',
  InTransit: 'IN_TRANSIT',
  Delivered: 'DELIVERED',
  Disputed: 'DISPUTED',
  Cancelled: 'CANCELLED',
};

/** shared_types::DeliveryId(pub u64) — a tuple/newtype struct. */
export function deliveryIdToScVal(chainDeliveryId: bigint): xdr.ScVal {
  return tupleStructToScVal(u64ToScVal(chainDeliveryId));
}

function cargoDescriptorToScVal(input: {
  weightGrams: number;
  cargoCategory: CargoCategory;
  fragile: boolean;
}): xdr.ScVal {
  return namedStructToScVal({
    weight_grams: u32ToScVal(input.weightGrams),
    category: unitEnumToScVal(CARGO_CATEGORY_TO_RUST[input.cargoCategory]),
    fragile: boolToScVal(input.fragile),
  });
}

/**
 * shared_types::DeliveryMetadata. Its `delivery_id` field is set to 0
 * unconditionally: `delivery_contract::create_delivery` always assigns the
 * `DeliveryRecord`'s real id from its own internal counter — the value
 * passed inside this metadata struct is accepted by the contract but never
 * actually used to identify the delivery (confirmed by reading
 * `create_delivery`'s implementation in PHASE_1_DOMAIN_ANALYSIS.md §4).
 */
export function deliveryMetadataToScVal(input: CreateDeliveryTxInput): xdr.ScVal {
  return namedStructToScVal({
    delivery_id: u64ToScVal(0n),
    origin: stringToScVal(input.origin),
    destination: stringToScVal(input.destination),
    cargo_description: cargoDescriptorToScVal({
      weightGrams: input.weightGrams,
      cargoCategory: input.cargoCategory,
      fragile: input.fragile,
    }),
    created_at: u64ToScVal(BigInt(Math.floor(Date.now() / 1000))),
    estimated_delivery: u64ToScVal(BigInt(Math.floor(input.estimatedDelivery.getTime() / 1000))),
  });
}

export function createDeliveryArgsToScVal(input: CreateDeliveryTxInput): xdr.ScVal[] {
  return [
    addressToScVal(input.senderAddress),
    addressToScVal(input.recipientAddress),
    deliveryMetadataToScVal(input),
  ];
}

function unwrapTupleStruct(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Expected a one-element Vec (tuple struct encoding)');
  }
  return value[0];
}

function unwrapUnitEnum(value: unknown): string {
  const inner = unwrapTupleStruct(value);
  if (typeof inner !== 'string') {
    throw new Error('Expected a Symbol (unit enum encoding)');
  }
  return inner;
}

function mapCargoCategory(value: unknown): CargoCategory {
  const variant = unwrapUnitEnum(value);
  const mapped = CARGO_CATEGORY_FROM_RUST[variant];
  if (!mapped) throw new Error(`Unknown CargoCategory variant: ${variant}`);
  return mapped;
}

function mapDeliveryStatus(value: unknown): DeliveryStatus {
  const variant = unwrapUnitEnum(value);
  const mapped = DELIVERY_STATUS_FROM_RUST[variant];
  if (!mapped) throw new Error(`Unknown DeliveryStatus variant: ${variant}`);
  return mapped;
}

function u64StringToDate(value: unknown): Date {
  if (typeof value !== 'string') throw new Error('Expected a u64-as-string value');
  return new Date(Number(value) * 1000);
}

function optionalU64StringToDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : u64StringToDate(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Expected "${field}" to be a string`);
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`Expected "${field}" to be a number`);
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Expected "${field}" to be a boolean`);
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected "${field}" to be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Decodes the native (post-`scValToNative`) shape of a `get_delivery`
 * return value into `ChainDeliveryRecord`. Throws on any structural
 * mismatch rather than silently returning partial data — a malformed
 * response here means the mapping is wrong or the contract's shape
 * changed, either of which should surface loudly, not as bad data quietly
 * written to the read model.
 */
export function nativeToChainDeliveryRecord(native: unknown): ChainDeliveryRecord {
  const record = requireRecord(native, 'DeliveryRecord');
  const metadata = requireRecord(record.metadata, 'metadata');
  const cargo = requireRecord(metadata.cargo_description, 'cargo_description');

  return {
    chainDeliveryId: BigInt(requireString(unwrapTupleStruct(record.delivery_id), 'delivery_id')),
    senderAddress: requireString(record.sender, 'sender'),
    recipientAddress: requireString(record.recipient, 'recipient'),
    driverAddress:
      record.driver === null || record.driver === undefined
        ? null
        : requireString(record.driver, 'driver'),
    status: mapDeliveryStatus(record.status),
    origin: requireString(metadata.origin, 'metadata.origin'),
    destination: requireString(metadata.destination, 'metadata.destination'),
    cargoCategory: mapCargoCategory(cargo.category),
    weightGrams: requireNumber(cargo.weight_grams, 'cargo_description.weight_grams'),
    fragile: requireBoolean(cargo.fragile, 'cargo_description.fragile'),
    createdAtChain: u64StringToDate(record.created_at),
    transitStartedAt: optionalU64StringToDate(record.transit_started_at),
    deliveredAt: optionalU64StringToDate(record.delivered_at),
  };
}
