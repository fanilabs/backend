import { Keypair } from '@stellar/stellar-sdk';
import type { SignatureVerifier } from '../domain/index.js';

/**
 * Verifies an ed25519 signature against a Stellar `G...` address using
 * `stellar-sdk`'s `Keypair` — the same primitive SEP-10 web-auth challenges
 * are built on. Any malformed address/signature is treated as "does not
 * verify" rather than thrown, so callers never need to distinguish
 * "invalid input" from "wrong signature."
 */
export function createStellarSignatureVerifier(): SignatureVerifier {
  return {
    verify(address, message, signatureBase64) {
      try {
        const keypair = Keypair.fromPublicKey(address);
        return keypair.verify(Buffer.from(message, 'utf8'), Buffer.from(signatureBase64, 'base64'));
      } catch {
        return false;
      }
    },
  };
}
