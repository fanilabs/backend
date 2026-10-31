import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  addressToScVal,
  boolToScVal,
  combine128,
  i128ToScVal,
  MAX_I128,
  MIN_I128,
  namedStructToScVal,
  scValToNative,
  stringToScVal,
  symbolToScVal,
  tupleStructToScVal,
  u32ToScVal,
  u64ToScVal,
  unitEnumToScVal,
} from './sc-val.js';

describe('scValToNative', () => {
  it('decodes primitive scalars', () => {
    expect(scValToNative(xdr.ScVal.scvVoid())).toBeNull();
    expect(scValToNative(xdr.ScVal.scvBool(true))).toBe(true);
    expect(scValToNative(xdr.ScVal.scvU32(42))).toBe(42);
    expect(scValToNative(xdr.ScVal.scvI32(-7))).toBe(-7);
  });

  it('decodes 64-bit integers as strings (no precision loss)', () => {
    expect(scValToNative(xdr.ScVal.scvU64(new xdr.Uint64(9007199254740993n)))).toBe(
      '9007199254740993',
    );
    expect(scValToNative(xdr.ScVal.scvI64(new xdr.Int64(-123456789012345n)))).toBe(
      '-123456789012345',
    );
  });

  it('decodes u128 by combining hi/lo words', () => {
    const parts = new xdr.UInt128Parts({ hi: new xdr.Uint64(1n), lo: new xdr.Uint64(500n) });
    // 1 * 2^64 + 500
    expect(scValToNative(xdr.ScVal.scvU128(parts))).toBe((2n ** 64n + 500n).toString());
  });

  it('decodes i128 correctly for a negative value', () => {
    // -1 in the hi word with lo=0 represents -2^64 in signed 128-bit terms
    const parts = new xdr.Int128Parts({ hi: new xdr.Int64(-1n), lo: new xdr.Uint64(0n) });
    expect(scValToNative(xdr.ScVal.scvI128(parts))).toBe((-(2n ** 64n)).toString());
  });

  it('decodes bytes to base64', () => {
    const buffer = Buffer.from([1, 2, 3]);
    expect(scValToNative(xdr.ScVal.scvBytes(buffer))).toBe(buffer.toString('base64'));
  });

  it('decodes strings and symbols', () => {
    expect(scValToNative(xdr.ScVal.scvString('hello'))).toBe('hello');
    expect(scValToNative(xdr.ScVal.scvSymbol('escrow_funded'))).toBe('escrow_funded');
  });

  it('decodes a vec recursively', () => {
    const vec = xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)]);
    expect(scValToNative(vec)).toEqual([1, 2]);
  });

  it('decodes a map into a plain object', () => {
    const map = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('amount'), val: xdr.ScVal.scvU32(100) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('fragile'), val: xdr.ScVal.scvBool(true) }),
    ]);
    expect(scValToNative(map)).toEqual({ amount: 100, fragile: true });
  });

  it('decodes a real Stellar address', () => {
    const keypair = Keypair.random();
    const scVal = new Address(keypair.publicKey()).toScVal();

    expect(scValToNative(scVal)).toBe(keypair.publicKey());
  });

  it('falls back to a labeled marker for an unsupported variant instead of throwing', () => {
    const timepoint = xdr.ScVal.scvTimepoint(new xdr.Uint64(1n));
    expect(scValToNative(timepoint)).toEqual({ unsupportedScValType: 'scvTimepoint' });
  });
});

describe('native -> ScVal encoders', () => {
  it('round-trips primitive scalars', () => {
    expect(scValToNative(u32ToScVal(42))).toBe(42);
    expect(scValToNative(boolToScVal(true))).toBe(true);
    expect(scValToNative(stringToScVal('hello'))).toBe('hello');
    expect(scValToNative(symbolToScVal('escrow_funded'))).toBe('escrow_funded');
    expect(scValToNative(u64ToScVal(9007199254740993n))).toBe('9007199254740993');
  });

  it('round-trips a real Stellar address', () => {
    const keypair = Keypair.random();
    expect(scValToNative(addressToScVal(keypair.publicKey()))).toBe(keypair.publicKey());
  });

  it('encodes a tuple/newtype struct as a one-element Vec', () => {
    // shared_types::DeliveryId(pub u64)
    const scVal = tupleStructToScVal(u64ToScVal(42n));

    expect(scVal.switch().name).toBe('scvVec');
    expect(scVal.vec()).toHaveLength(1);
    expect(scValToNative(scVal)).toEqual(['42']);
  });

  it('encodes a unit-variant enum as a one-element Vec of its Symbol name', () => {
    // shared_types::CargoCategory::Electronics
    const scVal = unitEnumToScVal('Electronics');

    expect(scVal.switch().name).toBe('scvVec');
    expect(scValToNative(scVal)).toEqual(['Electronics']);
  });

  it('encodes a named-field struct as a Map sorted by field name', () => {
    // shared_types::CargoDescriptor { weight_grams, category, fragile } —
    // declared in that order, but the encoded Map key order must be
    // alphabetical (category, fragile, weight_grams) for Soroban's Map
    // canonical-ordering requirement.
    const scVal = namedStructToScVal({
      weight_grams: u32ToScVal(500),
      category: unitEnumToScVal('Electronics'),
      fragile: boolToScVal(true),
    });

    expect(scVal.switch().name).toBe('scvMap');
    const map = scVal.map();
    expect(map).not.toBeNull();
    const keys = map?.map((entry) => scValToNative(entry.key()));
    expect(keys).toEqual(['category', 'fragile', 'weight_grams']);
    expect(scValToNative(scVal)).toEqual({
      category: ['Electronics'],
      fragile: true,
      weight_grams: 500,
    });
  });

  it('builds a realistic nested DeliveryMetadata-shaped structure', () => {
    const scVal = namedStructToScVal({
      delivery_id: u64ToScVal(7n),
      origin: stringToScVal('Lagos'),
      destination: stringToScVal('Accra'),
      cargo_description: namedStructToScVal({
        weight_grams: u32ToScVal(1200),
        category: unitEnumToScVal('Perishables'),
        fragile: boolToScVal(false),
      }),
      created_at: u64ToScVal(1_700_000_000n),
      estimated_delivery: u64ToScVal(1_700_100_000n),
    });

    expect(scValToNative(scVal)).toEqual({
      cargo_description: { category: ['Perishables'], fragile: false, weight_grams: 1200 },
      created_at: '1700000000',
      delivery_id: '7',
      destination: 'Accra',
      estimated_delivery: '1700100000',
      origin: 'Lagos',
    });
  });

  describe('i128ToScVal and 128-bit boundary checks (issue #468)', () => {
    it('round-trips small positive, zero, and negative values through scValToNative', () => {
      expect(scValToNative(i128ToScVal(0n))).toBe('0');
      expect(scValToNative(i128ToScVal(1n))).toBe('1');
      expect(scValToNative(i128ToScVal(-1n))).toBe('-1');
      expect(scValToNative(i128ToScVal(100_000_000n))).toBe('100000000');
      expect(scValToNative(i128ToScVal(-100_000_000n))).toBe('-100000000');
    });

    it('round-trips 64-bit boundary values', () => {
      const maxI64 = (1n << 63n) - 1n;
      const minI64 = -(1n << 63n);
      const maxU64 = (1n << 64n) - 1n;
      const minNegU64 = -(1n << 64n);

      expect(scValToNative(i128ToScVal(maxI64))).toBe(maxI64.toString());
      expect(scValToNative(i128ToScVal(minI64))).toBe(minI64.toString());
      expect(scValToNative(i128ToScVal(maxU64))).toBe(maxU64.toString());
      expect(scValToNative(i128ToScVal(minNegU64))).toBe(minNegU64.toString());
    });

    it('round-trips maximum signed 128-bit integer (2^127 - 1) with exact string equality', () => {
      const maxI128 = (1n << 127n) - 1n;
      expect(maxI128).toBe(MAX_I128);
      const scVal = i128ToScVal(maxI128);
      expect(scValToNative(scVal)).toBe('170141183460469231731687303715884105727');
      expect(scValToNative(scVal)).toBe(maxI128.toString());
    });

    it('round-trips minimum signed 128-bit integer (-2^127) with exact string equality', () => {
      const minI128 = -(1n << 127n);
      expect(minI128).toBe(MIN_I128);
      const scVal = i128ToScVal(minI128);
      expect(scValToNative(scVal)).toBe('-170141183460469231731687303715884105728');
      expect(scValToNative(scVal)).toBe(minI128.toString());
    });

    it('throws RangeError when input exceeds maximum signed 128-bit integer', () => {
      const overflow = MAX_I128 + 1n;
      expect(() => i128ToScVal(overflow)).toThrow(RangeError);
      expect(() => i128ToScVal(overflow)).toThrow(/outside signed 128-bit integer range/);
    });

    it('throws RangeError when input is below minimum signed 128-bit integer', () => {
      const underflow = MIN_I128 - 1n;
      expect(() => i128ToScVal(underflow)).toThrow(RangeError);
      expect(() => i128ToScVal(underflow)).toThrow(/outside signed 128-bit integer range/);
    });

    it('throws RangeError for large arbitrary out-of-bounds integers', () => {
      expect(() => i128ToScVal(1n << 200n)).toThrow(RangeError);
      expect(() => i128ToScVal(-(1n << 200n))).toThrow(RangeError);
    });
  });

  describe('combine128 bounds validation', () => {
    it('correctly combines valid hi and lo words', () => {
      expect(combine128(0n, 0n)).toBe('0');
      expect(combine128(1n, 500n)).toBe((2n ** 64n + 500n).toString());
      expect(combine128(-1n, 0n)).toBe((-(2n ** 64n)).toString());
    });

    it('throws RangeError when lo word is negative', () => {
      expect(() => combine128(0n, -1n)).toThrow(RangeError);
      expect(() => combine128(0n, -1n)).toThrow(/outside unsigned 64-bit range/);
    });

    it('throws RangeError when lo word exceeds 64-bit unsigned integer', () => {
      const invalidLo = 1n << 64n;
      expect(() => combine128(0n, invalidLo)).toThrow(RangeError);
      expect(() => combine128(0n, invalidLo)).toThrow(/outside unsigned 64-bit range/);
    });
  });
});
