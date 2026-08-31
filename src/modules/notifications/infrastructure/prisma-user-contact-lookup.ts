import type { PrismaClient } from '@prisma/client';
import type { UserContactLookup } from '../domain/index.js';

/**
 * Touches the shared `users`/`wallet_addresses` tables directly — see
 * `domain/ports.ts`'s `UserContactLookup` header comment for why that's a
 * deliberate exception to this backend's usual module-table-isolation
 * convention (mirrors `auth`'s own direct `User` table access).
 */
export function createPrismaUserContactLookup(prisma: PrismaClient): UserContactLookup {
  return {
    async findByWalletAddress(address) {
      const wallet = await prisma.walletAddress.findUnique({
        where: { address },
        select: { user: { select: { id: true, email: true } } },
      });
      return wallet ? { userId: wallet.user.id, email: wallet.user.email } : null;
    },

    async findByUserId(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      return user ? { userId: user.id, email: user.email } : null;
    },
  };
}
