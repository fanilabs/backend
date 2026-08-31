import { Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { addressToScVal, scValToNative, u64ToScVal } from '../../../blockchain/xdr/sc-val.js';
import {
  nativeToChainDriverProfile,
  registerDriverArgsToScVal,
  updateDriverKycStatusArgsToScVal,
} from './reputation-scval-mapping.js';

describe('registerDriverArgsToScVal', () => {
  it('produces [driver]', () => {
    const driver = Keypair.random().publicKey();

    const args = registerDriverArgsToScVal({ driverAddress: driver });

    expect(args).toHaveLength(1);
    expect(scValToNative(args[0]!)).toBe(driver);
  });
});

describe('updateDriverKycStatusArgsToScVal', () => {
  it('produces [admin, driver, kyc_verified]', () => {
    const admin = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();

    const args = updateDriverKycStatusArgsToScVal({
      adminAddress: admin,
      driverAddress: driver,
      kycVerified: true,
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[0]!)).toBe(admin);
    expect(scValToNative(args[1]!)).toBe(driver);
    expect(scValToNative(args[2]!)).toBe(true);
  });
});

function buildDriverProfileScVal(input: {
  address: string;
  deliveriesCompleted: number;
  reputationScore: number;
  kycVerified: boolean;
  registeredAt: bigint;
}): xdr.ScVal {
  return xdr.ScVal.scvMap(
    [
      ['address', addressToScVal(input.address)],
      ['deliveries_completed', xdr.ScVal.scvU32(input.deliveriesCompleted)],
      ['kyc_verified', xdr.ScVal.scvBool(input.kycVerified)],
      ['registered_at', u64ToScVal(input.registeredAt)],
      ['reputation_score', xdr.ScVal.scvU32(input.reputationScore)],
    ].map(
      ([k, v]) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k as string), val: v as xdr.ScVal }),
    ),
  );
}

describe('nativeToChainDriverProfile', () => {
  it('decodes a driver profile, with u32 fields as native numbers (not strings)', () => {
    const address = Keypair.random().publicKey();
    const scVal = buildDriverProfileScVal({
      address,
      deliveriesCompleted: 12,
      reputationScore: 62,
      kycVerified: true,
      registeredAt: 1_700_000_000n,
    });

    const profile = nativeToChainDriverProfile(scValToNative(scVal));

    expect(profile).toEqual({
      address,
      deliveriesCompleted: 12,
      reputationScore: 62,
      kycVerified: true,
      registeredAt: new Date(1_700_000_000 * 1000),
    });
  });

  it('throws on a structurally invalid profile rather than returning partial data', () => {
    expect(() => nativeToChainDriverProfile({ not: 'a driver profile' })).toThrow();
  });
});
