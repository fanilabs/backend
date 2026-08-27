import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { scValToNative } from './sc-val.js';

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
