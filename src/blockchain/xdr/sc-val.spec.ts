import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  addressToScVal,
  boolToScVal,
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
});
