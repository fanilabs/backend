import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Converts a Soroban `xdr.ScVal` into a plain JS value. Covers the variants
 * FaniLab's contracts actually use (Phase 1 domain analysis: u32/i32,
 * u64/i64, u128/i128, bool, string/Symbol, Address, Vec, Map) rather than
 * the full ScVal union — stellar-sdk 12.x doesn't ship a built-in
 * `scValToNative` helper (later SDK majors do), so this is a deliberately
 * scoped equivalent, not a workaround for a missing feature we forgot to use.
 *
 * 64-bit and 128-bit integers decode to `string`/`bigint` rather than
 * `number` to avoid silent precision loss — callers that need a specific
 * numeric type (e.g. the `escrow` module handling token amounts) convert
 * explicitly rather than this function guessing a lossy representation.
 */
export function scValToNative(scVal: xdr.ScVal): unknown {
  const kind = scVal.switch().name;

  switch (kind) {
    case 'scvVoid':
      return null;
    case 'scvBool':
      return scVal.b();
    case 'scvU32':
      return scVal.u32();
    case 'scvI32':
      return scVal.i32();
    case 'scvU64':
      return scVal.u64().toString();
    case 'scvI64':
      return scVal.i64().toString();
    case 'scvU128':
      return combine128(BigInt(scVal.u128().hi().toString()), BigInt(scVal.u128().lo().toString()));
    case 'scvI128':
      return combine128(BigInt(scVal.i128().hi().toString()), BigInt(scVal.i128().lo().toString()));
    case 'scvBytes':
      return scVal.bytes().toString('base64');
    case 'scvString':
      return bufferOrStringToString(scVal.str());
    case 'scvSymbol':
      return bufferOrStringToString(scVal.sym());
    case 'scvVec': {
      const vec = scVal.vec();
      return vec ? vec.map((item) => scValToNative(item)) : null;
    }
    case 'scvMap': {
      const map = scVal.map();
      if (!map) return null;
      const result: Record<string, unknown> = {};
      for (const entry of map) {
        const key = scValToNative(entry.key());
        result[typeof key === 'string' ? key : JSON.stringify(key)] = scValToNative(entry.val());
      }
      return result;
    }
    case 'scvAddress':
      return Address.fromScVal(scVal).toString();
    default:
      // Variants FaniLab's contracts don't emit (timepoint, duration,
      // u256/i256, error, contract instance, ledger key types) fall back to
      // a labeled marker rather than throwing — a malformed/unexpected
      // event should not crash the whole poll cycle (docs/EVENT_INDEXER.md).
      return { unsupportedScValType: kind };
  }
}

/** hi is the signed/unsigned upper 64 bits, lo the unsigned lower 64 bits —
 * `hi * 2^64 + lo` is the standard, correct split-word reconstruction for
 * both u128 (hi unsigned) and i128 (hi signed two's-complement) layouts. */
function combine128(hi: bigint, lo: bigint): string {
  return (hi * 2n ** 64n + lo).toString();
}

function bufferOrStringToString(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────
// Native → ScVal (transaction-building direction)
// ─────────────────────────────────────────────────────────────────────────
//
// These follow Soroban's documented `#[contracttype]` derive conventions:
//   - a tuple/newtype struct (single unnamed field, e.g. shared_types'
//     `DeliveryId(pub u64)`) encodes as a one-element Vec
//   - a unit-variant (C-like) enum encodes as a one-element Vec containing
//     the variant name as a Symbol
//   - a struct with named fields encodes as a Map keyed by Symbol field
//     names, sorted by key — Soroban's Map type requires sorted keys for
//     canonical/host-side representation
//
// IMPORTANT: none of FaniLab's contracts are deployed anywhere reachable
// from this environment (PHASE_1_DOMAIN_ANALYSIS.md), so these encoders are
// verified here against the documented convention and via round-trip
// through this file's own `scValToNative`, but NOT against a real deployed
// contract accepting a transaction built with them. Treat the struct/enum
// encoders as the first thing to validate (e.g. via `stellar contract
// invoke --sim`) once a real FaniLab deployment exists — see
// docs/EVENT_INDEXER.md's "Current Scope" section for the same caveat
// applied to the read side.

export function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

export function u32ToScVal(value: number): xdr.ScVal {
  return xdr.ScVal.scvU32(value);
}

export function u64ToScVal(value: bigint | number): xdr.ScVal {
  return xdr.ScVal.scvU64(new xdr.Uint64(BigInt(value)));
}

export function boolToScVal(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

export function stringToScVal(value: string): xdr.ScVal {
  return xdr.ScVal.scvString(value);
}

export function symbolToScVal(value: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(value);
}

/** Encodes a Rust tuple/newtype struct with a single unnamed field. */
export function tupleStructToScVal(fieldScVal: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvVec([fieldScVal]);
}

/** Encodes a C-like (all-unit-variant) Rust enum from its variant name. */
export function unitEnumToScVal(variantName: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variantName)]);
}

/** Encodes a Rust struct with named fields as a Map sorted by field name. */
export function namedStructToScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }));
  return xdr.ScVal.scvMap(entries);
}
