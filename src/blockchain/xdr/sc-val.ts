import { Address } from '@stellar/stellar-sdk';
import type { xdr } from '@stellar/stellar-sdk';

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
