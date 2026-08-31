import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { stellarAddress } from './stellar-address.js';

describe('stellarAddress', () => {
  it('accepts a valid, checksum-correct Ed25519 public key', () => {
    const valid = Keypair.random().publicKey();
    expect(stellarAddress.safeParse(valid).success).toBe(true);
  });

  it('rejects a shape-valid but checksum-invalid address', () => {
    // 56 characters, 'G' + base32 alphabet — passes the shape regex but not
    // the embedded CRC16 checksum (the bug this schema fixes; see the
    // docstring in stellar-address.ts).
    const checksumInvalid = 'G' + 'A'.repeat(55);
    const result = stellarAddress.safeParse(checksumInvalid);
    expect(result.success).toBe(false);
  });

  it('rejects a wrong-length string', () => {
    expect(stellarAddress.safeParse('G').success).toBe(false);
    expect(stellarAddress.safeParse('G'.repeat(56)).success).toBe(false);
  });

  it('rejects characters outside the base32 alphabet', () => {
    const invalid = `G${'2'.repeat(45)}01${'2'.repeat(10)}`;
    // Contains '0' and '1' which are not in [A-Z2-7].
    expect(stellarAddress.safeParse(invalid).success).toBe(false);
  });

  it('rejects a non-string input', () => {
    expect(stellarAddress.safeParse(123).success).toBe(false);
    expect(stellarAddress.safeParse(undefined).success).toBe(false);
  });
});