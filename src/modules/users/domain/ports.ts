import type { UserRecord, WalletAddressRecord } from './entities.js';

export interface UserReader {
  findById(id: string): Promise<UserRecord | null>;
}

export interface WalletAddressRepository {
  findById(id: string): Promise<WalletAddressRecord | null>;
  findByAddress(address: string): Promise<WalletAddressRecord | null>;
  findByUserId(userId: string): Promise<WalletAddressRecord[]>;
  create(input: {
    userId: string;
    address: string;
    isPrimary: boolean;
    verifiedAt: Date;
  }): Promise<WalletAddressRecord>;
  remove(id: string): Promise<void>;
}

export interface VerifiedChallenge {
  userId: string;
  address: string;
}

/**
 * Stateless wallet-ownership challenge, the same "signed short-TTL token"
 * pattern as auth's email-verification/password-reset tokens (see
 * docs/AUTHENTICATION.md) rather than a dedicated database table — the
 * challenge string itself *is* what the client signs with their wallet.
 */
export interface ChallengeService {
  issueWalletLinkChallenge(userId: string, address: string): string;
  verifyWalletLinkChallenge(challenge: string): VerifiedChallenge;
}

/**
 * Verifies an ed25519 signature against a Stellar public key (`G...`
 * address) — the same primitive SEP-10 web-auth is built on. Proves address
 * ownership without the backend ever touching a private key.
 */
export interface SignatureVerifier {
  verify(address: string, message: string, signatureBase64: string): boolean;
}
