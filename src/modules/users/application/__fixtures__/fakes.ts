import { randomUUID } from 'node:crypto';
import type {
  ChallengeService,
  SignatureVerifier,
  UserReader,
  UserRecord,
  VerifiedChallenge,
  WalletAddressRecord,
  WalletAddressRepository,
} from '../../domain/index.js';

export function createInMemoryUserReader(): UserReader & { seed(user: UserRecord): void } {
  const users = new Map<string, UserRecord>();
  return {
    seed(user) {
      users.set(user.id, user);
    },
    async findById(id) {
      return users.get(id) ?? null;
    },
  };
}

export function createInMemoryWalletAddressRepository(): WalletAddressRepository {
  const records = new Map<string, WalletAddressRecord>();
  return {
    async findById(id) {
      return records.get(id) ?? null;
    },
    async findByAddress(address) {
      for (const record of records.values()) {
        if (record.address === address) return record;
      }
      return null;
    },
    async findByUserId(userId) {
      return [...records.values()].filter((record) => record.userId === userId);
    },
    async create(input) {
      const record: WalletAddressRecord = {
        id: randomUUID(),
        userId: input.userId,
        address: input.address,
        isPrimary: input.isPrimary,
        verifiedAt: input.verifiedAt,
        createdAt: new Date(),
      };
      records.set(record.id, record);
      return record;
    },
    async remove(id) {
      records.delete(id);
    },
  };
}

/** Deterministic fake: the "challenge" a client signs is just an encoded
 * JSON payload, and "verifying" it is decoding + expiry checking — no real
 * cryptographic signing involved, since that's exercised separately by
 * StellarSignatureVerifier's own real unit tests. */
export function createFakeChallengeService(): ChallengeService & {
  issuedFor(userId: string, address: string, expiresAt: number): string;
} {
  function encode(userId: string, address: string, expiresAt: number): string {
    return Buffer.from(JSON.stringify({ userId, address, expiresAt }), 'utf8').toString(
      'base64url',
    );
  }

  return {
    issuedFor: encode,
    issueWalletLinkChallenge(userId, address) {
      return encode(userId, address, Date.now() + 5 * 60 * 1000);
    },
    verifyWalletLinkChallenge(challenge): VerifiedChallenge {
      let decoded: { userId?: string; address?: string; expiresAt?: number };
      try {
        decoded = JSON.parse(Buffer.from(challenge, 'base64url').toString('utf8'));
      } catch {
        throw new Error('malformed challenge');
      }
      if (!decoded.userId || !decoded.address || !decoded.expiresAt) {
        throw new Error('malformed challenge');
      }
      if (decoded.expiresAt < Date.now()) {
        throw new Error('expired challenge');
      }
      return { userId: decoded.userId, address: decoded.address };
    },
  };
}

/** A signature is "valid" iff it equals `valid-signature-for:<message>` —
 * exercises the use case's control flow without real cryptography. */
export function createFakeSignatureVerifier(): SignatureVerifier {
  return {
    verify(_address, message, signatureBase64) {
      return signatureBase64 === `valid-signature-for:${message}`;
    },
  };
}

export function buildUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: randomUUID(),
    email: 'user@example.com',
    role: 'CUSTOMER',
    emailVerifiedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}
