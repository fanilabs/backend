import { describe, expect, it } from 'vitest';
import { payoutAddressResponseSchema } from './schemas.js';

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
