import { addEvidenceHashBodySchema } from './schemas';

describe('addEvidenceHashBodySchema', () => {
  const lowercaseHash =
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const uppercaseHash =
    'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
  const mixedCaseHash =
    'e3B0c44298Fc1c149afbF4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('accepts a lowercase SHA-256 digest', () => {
    const result = addEvidenceHashBodySchema.safeParse({
      evidenceHash: lowercaseHash,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidenceHash).toBe(lowercaseHash);
    }
  });

  it('accepts an uppercase SHA-256 digest and normalizes it to lowercase', () => {
    const result = addEvidenceHashBodySchema.safeParse({
      evidenceHash: uppercaseHash,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidenceHash).toBe(lowercaseHash);
    }
  });

  it('accepts a mixed-case SHA-256 digest and normalizes it to lowercase', () => {
    const result = addEvidenceHashBodySchema.safeParse({
      evidenceHash: mixedCaseHash,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidenceHash).toBe(lowercaseHash);
    }
  });

  it('rejects a digest that is not 64 characters', () => {
    const result = addEvidenceHashBodySchema.safeParse({
      evidenceHash: 'abc123',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a digest containing non-hex characters', () => {
    const result = addEvidenceHashBodySchema.safeParse({
      evidenceHash: 'g'.repeat(64),
    });

    expect(result.success).toBe(false);
  });
});
