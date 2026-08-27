import type { RefreshTokenRecord, User, UserRole } from './entities.js';

/**
 * Every dependency the `auth` application layer needs, expressed as a port
 * (interface) it depends on rather than a concrete library/framework. The
 * `infrastructure/` layer provides the real implementations (Prisma,
 * bcrypt, jsonwebtoken); tests provide in-memory ones. Neither this file
 * nor anything in `application/` imports Prisma, bcrypt, or jsonwebtoken
 * directly — see ARCHITECTURE.md §1.
 */

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: { email: string; passwordHash: string; role: UserRole }): Promise<User>;
  markEmailVerified(id: string): Promise<void>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}

export interface RefreshTokenRepository {
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

export interface IssuedRefreshToken {
  /** Raw token returned to the client — never persisted as-is. */
  token: string;
  /** Deterministic hash of `token`, safe to persist and re-derive for lookup. */
  tokenHash: string;
  expiresAt: Date;
}

export interface VerifiedRefreshToken {
  userId: string;
  tokenHash: string;
}

/**
 * Handles both session tokens (access/refresh) and single-purpose,
 * stateless verification tokens (email verification, password reset).
 * The latter are signed JWTs with a short TTL rather than their own DB
 * tables — see docs/AUTHENTICATION.md for why, including how a password
 * reset token embeds a fingerprint of the current password hash so it's
 * automatically invalidated the moment the password actually changes.
 */
export interface TokenService {
  issueAccessToken(user: Pick<User, 'id' | 'role'>): string;
  issueRefreshToken(user: Pick<User, 'id'>): IssuedRefreshToken;
  verifyRefreshToken(token: string): VerifiedRefreshToken;
  /** Deterministic hash with no signature/expiry check — used for revocation
   * lookups (logout) where a best-effort match is enough even if the token
   * is already expired or malformed. */
  hashToken(token: string): string;

  issueEmailVerificationToken(user: Pick<User, 'id' | 'email'>): string;
  verifyEmailVerificationToken(token: string): { userId: string };

  issuePasswordResetToken(user: Pick<User, 'id' | 'passwordHash'>): string;
  verifyPasswordResetToken(token: string, currentPasswordHash: string): { userId: string };
  /** Reads the claimed subject without verifying the signature — used only
   * to know *which* user's current password hash to check the token's
   * fingerprint against before calling `verifyPasswordResetToken`. */
  peekPasswordResetSubject(token: string): string | null;
}

export interface Mailer {
  sendVerificationEmail(to: string, token: string): Promise<void>;
  sendPasswordResetEmail(to: string, token: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
