import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { addEvidenceHashBodySchema, evidenceHash } from './schemas.js';

describe('evidenceHash schema (issue #462)', () => {
  const lowercaseSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const uppercaseSha256 = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
  const mixedCaseSha256 = 'E3b0C44298fc1C149AfbF4C8996FB92427AE41e4649b934CA495991B7852b855';

  it('accepts valid lowercase 64-character hex SHA-256 digest', () => {
    const result = evidenceHash.safeParse(lowercaseSha256);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(lowercaseSha256);
    }
  });

  it('accepts valid uppercase 64-character hex SHA-256 digest and normalizes to lowercase', () => {
    const result = evidenceHash.safeParse(uppercaseSha256);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(lowercaseSha256);
    }
  });

  it('accepts mixed-case 64-character hex SHA-256 digest and normalizes to lowercase', () => {
    const result = evidenceHash.safeParse(mixedCaseSha256);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(lowercaseSha256);
    }
  });

  it('rejects digests shorter than 64 characters', () => {
    const shortHash = lowercaseSha256.slice(0, 63);
    const result = evidenceHash.safeParse(shortHash);
    expect(result.success).toBe(false);
  });

  it('rejects digests longer than 64 characters', () => {
    const longHash = lowercaseSha256 + 'a';
    const result = evidenceHash.safeParse(longHash);
    expect(result.success).toBe(false);
  });

  it('rejects digests containing non-hexadecimal characters', () => {
    const invalidHex = lowercaseSha256.slice(0, 63) + 'g';
    const result = evidenceHash.safeParse(invalidHex);
    expect(result.success).toBe(false);
  });

  it('rejects empty string or strings with whitespace', () => {
    expect(evidenceHash.safeParse('').success).toBe(false);
    expect(evidenceHash.safeParse(' ' + lowercaseSha256.slice(1)).success).toBe(false);
  });
});

describe('addEvidenceHashBodySchema integration with evidenceHash (issue #462)', () => {
  const callerAddress = Keypair.random().publicKey();
  const uppercaseSha256 = 'AABBCCDD'.repeat(8);
  const expectedLower = uppercaseSha256.toLowerCase();

  it('normalizes uppercase evidenceHash when parsing addEvidenceHashBodySchema', () => {
    const payload = {
      callerAddress,
      chainDeliveryId: '42',
      evidenceHash: uppercaseSha256,
    };

    const parsed = addEvidenceHashBodySchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.evidenceHash).toBe(expectedLower);
      expect(parsed.data.chainDeliveryId).toBe('42');
      expect(parsed.data.callerAddress).toBe(callerAddress);
    }
  });

  it('rejects invalid evidenceHash in addEvidenceHashBodySchema', () => {
    const payload = {
      callerAddress,
      chainDeliveryId: '42',
      evidenceHash: 'not-a-valid-sha256-hash',
    };

    const parsed = addEvidenceHashBodySchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
