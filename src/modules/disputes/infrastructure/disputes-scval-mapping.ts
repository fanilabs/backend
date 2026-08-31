import type { DisputeStatus } from '@prisma/client';
import type { xdr } from '@stellar/stellar-sdk';
import {
  addressToScVal,
  bytesToScVal,
  tupleStructToScVal,
  u32ToScVal,
  u64ToScVal,
} from '../../../blockchain/xdr/sc-val.js';
import type {
  AddEvidenceHashTxInput,
  ChainDisputeCase,
  RaiseDisputeTxInput,
  ResolveDisputeSplitFundsTxInput,
  ResolveDisputeTxInput,
} from '../domain/index.js';

/**
 * ScVal encoding/decoding specific to `dispute_resolution_contract`'s own
 * types (`DisputeCase`/`DisputeStatus`, per
 * FaniLab-SmartContract/contracts/dispute_resolution_contract/lib.rs). Kept
 * separate from the generic `src/blockchain/xdr/sc-val.ts` helpers, same
 * rationale as escrow/deliveries' own `*-scval-mapping.ts` files.
 *
 * Load-bearing difference from `escrow_contract`, verified directly against
 * `dispute_resolution_contract/lib.rs`: every function here takes
 * `delivery_id: DeliveryId` — the tuple/newtype struct
 * (`shared_types::DeliveryId(pub u64)`) — **not** the bare `u64`
 * `escrow_contract` uses. It is encoded as a one-element Vec via
 * `tupleStructToScVal`, same convention `delivery_contract` uses.
 *
 * Same standing caveat as every other module's *-scval-mapping.ts: verified
 * by construction and round-trip, not yet against a live deployed contract
 * (none is reachable from this repository's environment).
 */

const DISPUTE_STATUS_FROM_RUST: Record<string, DisputeStatus> = {
  Open: 'OPEN',
  ResolvedRefund: 'RESOLVED_REFUND',
  ResolvedPayout: 'RESOLVED_PAYOUT',
  Split: 'SPLIT',
};

function deliveryIdScVal(chainDeliveryId: bigint): xdr.ScVal {
  return tupleStructToScVal(u64ToScVal(chainDeliveryId));
}

/** `raise_dispute(caller, delivery_id)`. */
export function raiseDisputeArgsToScVal(input: RaiseDisputeTxInput): xdr.ScVal[] {
  return [addressToScVal(input.callerAddress), deliveryIdScVal(input.chainDeliveryId)];
}

/** `add_evidence_hash(caller, delivery_id, evidence_hash: BytesN<32>)`. */
export function addEvidenceHashArgsToScVal(input: AddEvidenceHashTxInput): xdr.ScVal[] {
  return [
    addressToScVal(input.callerAddress),
    deliveryIdScVal(input.chainDeliveryId),
    bytesToScVal(input.evidenceHash),
  ];
}

/** Shared shape for `resolve_dispute_refund_sender(caller, delivery_id)` and
 * `resolve_dispute_pay_driver(caller, delivery_id)` — identical signatures. */
export function resolveDisputeArgsToScVal(input: ResolveDisputeTxInput): xdr.ScVal[] {
  return [addressToScVal(input.callerAddress), deliveryIdScVal(input.chainDeliveryId)];
}

/** `resolve_dispute_split_funds(caller, delivery_id, sender_share_bps: u32)`. */
export function resolveDisputeSplitFundsArgsToScVal(
  input: ResolveDisputeSplitFundsTxInput,
): xdr.ScVal[] {
  return [
    addressToScVal(input.callerAddress),
    deliveryIdScVal(input.chainDeliveryId),
    u32ToScVal(input.senderShareBps),
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

function mapDisputeStatus(value: unknown): DisputeStatus {
  const variant = unwrapUnitEnum(value);
  const mapped = DISPUTE_STATUS_FROM_RUST[variant];
  if (!mapped) throw new Error(`Unknown DisputeStatus variant: ${variant}`);
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

/** `scValToNative` decodes `scvBytes` to base64 (see that file's doc
 * comment) — this backend's own APIs use hex for hashes (matches
 * conventional sha256-hex-digest form, and `AddEvidenceHashTxInput` expects
 * it), so every on-chain-sourced hash is normalized to hex here. */
function base64ToHex(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a base64-encoded bytes value');
  return Buffer.from(value, 'base64').toString('hex');
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected "${field}" to be an array`);
  return value;
}

/**
 * Decodes the native (post-`scValToNative`) shape of a `get_dispute` return
 * value into `ChainDisputeCase`. `record.delivery_id` (itself a
 * tuple-wrapped u64) is ignored in favor of the caller-supplied
 * `chainDeliveryId`, same rationale as `nativeToChainEscrowRecord`.
 */
export function nativeToChainDisputeCase(
  native: unknown,
  chainDeliveryId: bigint,
): ChainDisputeCase {
  const record = requireRecord(native, 'DisputeCase');

  return {
    chainDeliveryId,
    status: mapDisputeStatus(record.status),
    raisedBy: requireString(record.raised_by, 'raised_by'),
    raisedAt: u64StringToDate(record.raised_at),
    evidenceHashes: requireArray(record.evidence_hashes, 'evidence_hashes').map(base64ToHex),
  };
}
