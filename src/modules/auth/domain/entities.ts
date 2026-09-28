import type { UserRole } from '@prisma/client';

export type { UserRole };

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** See `users.token_version` (prisma/schema.prisma) — bumped to
   * immediately invalidate already-issued access tokens (security issue
   * #12), embedded in every freshly-issued access token so the shared HTTP
   * auth guard can reject stale ones. */
  tokenVersion: number;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}
