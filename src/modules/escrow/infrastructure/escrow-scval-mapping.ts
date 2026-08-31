import type { EscrowStatus } from '@prisma/client';
import type { xdr } from '@stellar/stellar-sdk';
import { addressToScVal, i128ToScVal, u64ToScVal } from '../../../blockchain/xdr/sc-val.js';
import type { ChainEscrowRecord, CreateEscrowTxInput } from '../domain/index.js';

/**
 * ScVal encoding/decoding specific to `escrow_contract`'s own types
 * (shared_types::EscrowRecord/EscrowState, per
 * FaniLab-SmartContract/contracts/shared_types/lib.rs and
 * escrow_contract/lib.rs). Kept separate from the generic
 * `src/blockchain/xdr/sc-val.ts` helpers, same rationale as
 * deliveries/infrastructure/delivery-scval-mapping.ts.
 *
 * Two load-bearing differences from the deliveries module, both verified
 * directly against escrow_contract/lib.rs:
 *  - `delivery_id` is a bare `u64` function argument here, NOT the
 *    `DeliveryId` tuple/newtype struct delivery_contract uses — so it's
 *    encoded with plain `u64ToScVal`, never `tupleStructToScVal`.
 *  - `EscrowRecord` itself has no `delivery_id` field at all (it's the
 *    storage map's key, not part of the stored value), and no
 *    `platform_fee`/`released_at`/`refunded_at` fields — those are derived
 *    off-chain from event payloads/closedAt, not part of on-chain state.
 *
 * Same standing caveat as delivery-scval-mapping.ts: verified by
 * construction and round-trip, not yet against a live deployed contract.
 */

const ESCROW_STATUS_FROM_RUST: Record<string, EscrowStatus> = {
  Locked: 'LOCKED',
  Released: 'RELEASED',
  Refunded: 'REFUNDED',
  Paused: 'PAUSED',
};

/** `create_escrow(sender, recipient, driver, delivery_id, token, amount)`. */
export function createEscrowArgsToScVal(input: CreateEscrowTxInput): xdr.ScVal[] {
  return [
    addressToScVal(input.senderAddress),
    addressToScVal(input.recipientAddress),
    addressToScVal(input.driverAddress),
    u64ToScVal(input.chainDeliveryId),
    addressToScVal(input.token),
    i128ToScVal(input.amount),
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

function mapEscrowStatus(value: unknown): EscrowStatus {
  const variant = unwrapUnitEnum(value);
  const mapped = ESCROW_STATUS_FROM_RUST[variant];
  if (!mapped) throw new Error(`Unknown EscrowState variant: ${variant}`);
  return mapped;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Expected "${field}" to be a string`);
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected "${field}" to be an object`);
  }
  return value as Record<string, unknown>;
}

function u64StringToDate(value: unknown): Date {
  if (typeof value !== 'string') throw new Error('Expected a u64-as-string value');
  return new Date(Number(value) * 1000);
}

function optionalU64StringToDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : u64StringToDate(value);
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requireString(value, 'optional field');
}

/**
 * Decodes the native (post-`scValToNative`) shape of a `get_escrow` return
 * value into `ChainEscrowRecord`. The caller supplies `chainDeliveryId`
 * separately since the on-chain struct doesn't carry it (it's the storage
 * key, not a field) — mirrors how the caller always already knows which
 * delivery id it queried for.
 */
export function nativeToChainEscrowRecord(
  native: unknown,
  chainDeliveryId: bigint,
): ChainEscrowRecord {
  const record = requireRecord(native, 'EscrowRecord');

  return {
    chainDeliveryId,
    senderAddress: requireString(record.sender, 'sender'),
    recipientAddress: requireString(record.recipient, 'recipient'),
    driverAddress: requireString(record.driver, 'driver'),
    token: requireString(record.token, 'token'),
    amount: BigInt(requireString(record.amount, 'amount')),
    status: mapEscrowStatus(record.status),
    disputedBy: optionalString(record.disputed_by),
    disputedAt: optionalU64StringToDate(record.disputed_at),
    createdAtChain: u64StringToDate(record.created_at),
  };
}
