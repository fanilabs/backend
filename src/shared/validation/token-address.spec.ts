import { randomBytes } from 'node:crypto';
import { Address, Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { tokenAddress } from './token-address.js';

describe('tokenAddress', () => {
  it('accepts a valid Ed25519 public key (G...)', () => {
    const valid = Keypair.random().publicKey();
    expect(tokenAddress.safeParse(valid).success).toBe(true);
  });

  it('accepts a valid contract address (C...)', () => {
    const contractAddr = Address.contract(randomBytes(32)).toString();
    expect(tokenAddress.safeParse(contractAddr).success).toBe(true);
  });

  it('rejects a shape-valid but checksum-invalid Ed25519 address', () => {
    // 56 characters, 'G' + base32 alphabet — passes the shape regex but not
    // the embedded CRC16 checksum.
    const checksumInvalid = 'G' + 'A'.repeat(55);
    const result = tokenAddress.safeParse(checksumInvalid);
    expect(result.success).toBe(false);
  });

  it('rejects a shape-valid but checksum-invalid contract address', () => {
    // 56 characters, 'C' + base32 alphabet — passes the shape regex but not
    // the embedded CRC16 checksum.
    const checksumInvalid = 'C' + 'A'.repeat(55);
    const result = tokenAddress.safeParse(checksumInvalid);
    expect(result.success).toBe(false);
  });

  it('rejects an address with wrong prefix', () => {
    expect(tokenAddress.safeParse('B' + 'A'.repeat(55)).success).toBe(false);
  });

  it('rejects a wrong-length string', () => {
    expect(tokenAddress.safeParse('G').success).toBe(false);
    expect(tokenAddress.safeParse('G'.repeat(56)).success).toBe(false);
    expect(tokenAddress.safeParse('C').success).toBe(false);
    expect(tokenAddress.safeParse('C'.repeat(56)).success).toBe(false);
  });

  it('rejects characters outside the base32 alphabet', () => {
    const invalid = `G${'2'.repeat(45)}01${'2'.repeat(10)}`;
    // Contains '0' and '1' which are not in [A-Z2-7].
    expect(tokenAddress.safeParse(invalid).success).toBe(false);
  });

  it('rejects a non-string input', () => {
    expect(tokenAddress.safeParse(123).success).toBe(false);
    expect(tokenAddress.safeParse(undefined).success).toBe(false);
  });
});
