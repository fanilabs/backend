import { describe, expect, it } from 'vitest';
import {
  nativeToChainDriverProfile,
  registerDriverArgsToScVal,
  updateDriverKycStatusArgsToScVal,
} from './reputation-scval-mapping.js';

const VALID_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function validNativeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: VALID_ADDRESS,
    deliveries_completed: 3,
    reputation_score: 42,
    kyc_verified: true,
    registered_at: '1700000000',
    ...overrides,
  };
}

describe('registerDriverArgsToScVal', () => {
  it('encodes the driver address as a single Address argument', () => {
    const args = registerDriverArgsToScVal({ driverAddress: VALID_ADDRESS });
    expect(args).toHaveLength(1);
    expect(args[0].switch().name).toBe('address');
  });
});

describe('updateDriverKycStatusArgsToScVal', () => {
  it('encodes admin, driver and kyc flag in order', () => {
    const args = updateDriverKycStatusArgsToScVal({
      adminAddress: VALID_ADDRESS,
      driverAddress: VALID_ADDRESS,
      kycVerified: false,
    });
    expect(args).toHaveLength(3);
    expect(args[0].switch().name).toBe('address');
    expect(args[1].switch().name).toBe('address');
    expect(args[2].switch().name).toBe('bool');
  });
});

describe('nativeToChainDriverProfile', () => {
  it('decodes a fully valid native profile', () => {
    const profile = nativeToChainDriverProfile(validNativeProfile());
    expect(profile).toEqual({
      address: VALID_ADDRESS,
      deliveriesCompleted: 3,
      reputationScore: 42,
      kycVerified: true,
      registeredAt: new Date(1700000000 * 1000),
    });
  });

  it('rejects a structurally invalid root', () => {
    expect(() => nativeToChainDriverProfile(null)).toThrow(/DriverProfile/);
    expect(() => nativeToChainDriverProfile('nope')).toThrow(/DriverProfile/);
  });

  describe('field-type failures (one field at a time, all others valid)', () => {
    const cases: Array<{ field: string; overrides: Record<string, unknown> }> = [
      { field: 'address', overrides: { address: 123 } },
      { field: 'deliveries_completed', overrides: { deliveries_completed: '3' } },
      { field: 'reputation_score', overrides: { reputation_score: '42' } },
      { field: 'kyc_verified', overrides: { kyc_verified: 'true' } },
    ];

    it.each(cases)('rejects wrong type for "$field" with field-specific context', ({ field, overrides }) => {
      expect(() => nativeToChainDriverProfile(validNativeProfile(overrides))).toThrow(
        new RegExp(`"${field}"`),
      );
    });

    it('does not let valid surrounding fields hide the corrupted field', () => {
      const corrupted = validNativeProfile({ reputation_score: '42' });
      expect(() => nativeToChainDriverProfile(corrupted)).toThrow(/"reputation_score"/);
    });
  });

  describe('falsy-but-present controls', () => {
    it('accepts kyc_verified false rather than treating it as absent', () => {
      const profile = nativeToChainDriverProfile(validNativeProfile({ kyc_verified: false }));
      expect(profile.kycVerified).toBe(false);
    });

    it('accepts numeric zero counts rather than treating them as absent', () => {
      const profile = nativeToChainDriverProfile(
        validNativeProfile({ deliveries_completed: 0, reputation_score: 0 }),
      );
      expect(profile.deliveriesCompleted).toBe(0);
      expect(profile.reputationScore).toBe(0);
    });
  });
});
