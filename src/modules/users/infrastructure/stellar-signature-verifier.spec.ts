import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createStellarSignatureVerifier } from './stellar-signature-verifier.js';

describe('createStellarSignatureVerifier', () => {
  it('accepts a genuine ed25519 signature for the given message and address', () => {
    const verifier = createStellarSignatureVerifier();
    const keypair = Keypair.random();
    const message = 'sign-me';
    const signature = keypair.sign(Buffer.from(message, 'utf8')).toString('base64');

    expect(verifier.verify(keypair.publicKey(), message, signature)).toBe(true);
  });

  it('rejects a signature for a different message', () => {
    const verifier = createStellarSignatureVerifier();
    const keypair = Keypair.random();
    const signature = keypair.sign(Buffer.from('original-message', 'utf8')).toString('base64');

    expect(verifier.verify(keypair.publicKey(), 'tampered-message', signature)).toBe(false);
  });

  it('rejects a signature produced by a different keypair', () => {
    const verifier = createStellarSignatureVerifier();
    const signer = Keypair.random();
    const claimedAddress = Keypair.random();
    const message = 'sign-me';
    const signature = signer.sign(Buffer.from(message, 'utf8')).toString('base64');

    expect(verifier.verify(claimedAddress.publicKey(), message, signature)).toBe(false);
  });

  it('returns false, not throw, for a malformed address', () => {
    const verifier = createStellarSignatureVerifier();
    expect(verifier.verify('not-a-real-address', 'message', 'c2lnbmF0dXJl')).toBe(false);
  });

  it('returns false, not throw, for a malformed signature', () => {
    const verifier = createStellarSignatureVerifier();
    const keypair = Keypair.random();
    expect(verifier.verify(keypair.publicKey(), 'message', 'not-base64!!!')).toBe(false);
  });
});
