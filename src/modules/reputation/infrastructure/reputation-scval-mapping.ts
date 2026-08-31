import type { xdr } from '@stellar/stellar-sdk';
import { addressToScVal, boolToScVal } from '../../../blockchain/xdr/sc-val.js';
import type {
  ChainDriverProfile,
  RegisterDriverTxInput,
  UpdateDriverKycStatusTxInput,
} from '../domain/index.js';

/**
 * ScVal encoding/decoding specific to `identity_reputation_contract`'s own
 * `DriverProfile` type (per
 * FaniLab-SmartContract/contracts/identity_reputation_contract/lib.rs).
 * Kept separate from the generic `src/blockchain/xdr/sc-val.ts` helpers,
 * same rationale as every other module's own `*-scval-mapping.ts`.
 *
 * No tuple/newtype-struct or unit-enum encoding needed here, unlike
 * escrow/deliveries/disputes — every argument is a bare `Address`/`bool`,
 * and `DriverProfile` is a plain named-field struct with no nested enum.
 *
 * `deliveries_completed`/`reputation_score` are `u32` — `scValToNative`
 * decodes those to a native JS `number` directly (see that file's
 * `scvU32` case), unlike the `u64`/`i128` fields elsewhere in this codebase
 * that decode to `string`/`bigint` to avoid precision loss.
 *
 * Same standing caveat as every other module's *-scval-mapping.ts: verified
 * by construction and round-trip, not yet against a live deployed contract.
 */

/** `register_driver(driver)`. */
export function registerDriverArgsToScVal(input: RegisterDriverTxInput): xdr.ScVal[] {
  return [addressToScVal(input.driverAddress)];
}

/** `update_driver_kyc_status(admin, driver, kyc_verified)`. */
export function updateDriverKycStatusArgsToScVal(input: UpdateDriverKycStatusTxInput): xdr.ScVal[] {
  return [
    addressToScVal(input.adminAddress),
    addressToScVal(input.driverAddress),
    boolToScVal(input.kycVerified),
  ];
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected "${field}" to be an object`);
  }
  return value as Record<string, unknown>;
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

function u64StringToDate(value: unknown): Date {
  if (typeof value !== 'string') throw new Error('Expected a u64-as-string value');
  return new Date(Number(value) * 1000);
}

/**
 * Decodes the native (post-`scValToNative`) shape of a `get_driver_profile`
 * return value into `ChainDriverProfile`. The `address` field is decoded
 * from the record itself rather than trusting the caller's input address,
 * since the contract echoes it back and this keeps the function a pure
 * decoder (mirrors `nativeToChainDisputeCase`'s and
 * `nativeToChainEscrowRecord`'s own conventions, adapted here since,
 * unlike those, `address` genuinely is part of the on-chain struct).
 */
export function nativeToChainDriverProfile(native: unknown): ChainDriverProfile {
  const record = requireRecord(native, 'DriverProfile');

  return {
    address: requireString(record.address, 'address'),
    deliveriesCompleted: requireNumber(record.deliveries_completed, 'deliveries_completed'),
    reputationScore: requireNumber(record.reputation_score, 'reputation_score'),
    kycVerified: requireBoolean(record.kyc_verified, 'kyc_verified'),
    registeredAt: u64StringToDate(record.registered_at),
  };
}
