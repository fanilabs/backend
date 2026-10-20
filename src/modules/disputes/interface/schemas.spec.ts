import { describe, expect, it } from 'vitest';
import { addEvidenceHashBodySchema } from './schemas.js';

describe('evidenceHash uppercase hex support (#462)', () => {
  it('accepts uppercase SHA-256 hex digests and normalizes to lowercase', () => {
    const upper = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
    const parsed = addEvidenceHashBodySchema.parse({
      callerAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
      chainDeliveryId: '1',
      evidenceHash: upper,
    });
    expect(parsed.evidenceHash).toBe(upper.toLowerCase());
  });
});
