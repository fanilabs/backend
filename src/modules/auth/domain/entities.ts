import type { UserRole } from '@prisma/client';

export type { UserRole };

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
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
