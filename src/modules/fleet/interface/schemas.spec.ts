import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { addDriverToFleetBodySchema, payoutAddressResponseSchema } from './schemas.js';

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

describe('addDriverToFleetBodySchema (#401)', () => {
  it('rejects adding a driver whose address matches callerAddress', () => {
    const addr = Keypair.random().publicKey();
    const result = addDriverToFleetBodySchema.safeParse({
      callerAddress: addr,
      chainFleetId: '1',
      driverAddress: addr,
    });
    expect(result.success).toBe(false);
  });
});
