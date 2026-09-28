import { describe, expect, it } from 'vitest';
import { gmvResponseSchema } from './schemas.js';

describe('GMV response schema', () => {
  it('accepts released amounts up to 100 characters', () => {
    expect(
      gmvResponseSchema.safeParse({
        data: [{ token: 'XLM', releasedAmount: '1'.repeat(100), releasedCount: 1 }],
      }).success,
    ).toBe(true);
  });

  it('rejects released amounts longer than 100 characters', () => {
    expect(
      gmvResponseSchema.safeParse({
        data: [{ token: 'XLM', releasedAmount: '1'.repeat(101), releasedCount: 1 }],
      }).success,
    ).toBe(false);
  });
});
