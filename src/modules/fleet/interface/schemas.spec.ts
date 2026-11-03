import { describe, expect, it } from 'vitest';
import { addDriverToFleetBodySchema, payoutAddressResponseSchema } from './schemas.js';
import { testAddress } from '../../../shared/testing/addresses.js';

describe('payoutAddressResponseSchema', () => {
  it('accepts payout addresses up to the maximum address length', () => {
    const result = payoutAddressResponseSchema.safeParse({
      data: { payoutAddress: 'A'.repeat(128) },
    });

    expect(result.success).toBe(true);
  });

  it('rejects payout addresses longer than the maximum address length', () => {
    const result = payoutAddressResponseSchema.safeParse({
      data: { payoutAddress: 'A'.repeat(129) },
    });

    expect(result.success).toBe(false);
  });
});

describe('addDriverToFleetBodySchema', () => {
  const callerAddress = testAddress('fleet-schema-owner');
  const driverAddress = testAddress('fleet-schema-driver');

  it('accepts distinct caller and driver addresses', () => {
    const result = addDriverToFleetBodySchema.safeParse({
      callerAddress,
      chainFleetId: '1',
      driverAddress,
    });

    expect(result.success).toBe(true);
  });

  it('rejects when driver address equals caller address', () => {
    const result = addDriverToFleetBodySchema.safeParse({
      callerAddress,
      chainFleetId: '1',
      driverAddress: callerAddress,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'driverAddress');
      expect(issue?.message).toBe('Driver address cannot be the same as caller address');
    }
  });
});
