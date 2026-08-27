import type { UserRole } from '@prisma/client';

export type { UserRole };

/**
 * `users` reads the account created by the `auth` module but does not own
 * it — this is a narrower, module-local view (no passwordHash), not a
 * cross-module import of auth's domain types (see eslint.config.js: no
 * module may reach into another module's domain/infrastructure directly).
 */
export interface UserRecord {
  id: string;
  email: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface WalletAddressRecord {
  id: string;
  userId: string;
  address: string;
  isPrimary: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
}
