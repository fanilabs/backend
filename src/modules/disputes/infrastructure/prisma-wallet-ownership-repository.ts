import type { PrismaClient } from '@prisma/client';
import type { WalletOwnershipRepository } from '../domain/index.js';

/** Reads the shared `wallet_addresses` table directly — see
 * `domain/ports.ts`'s `WalletOwnershipRepository` header comment for why
 * that's a deliberate, precedented exception here. */
export function createPrismaWalletOwnershipRepository(
  prisma: PrismaClient,
): WalletOwnershipRepository {
  return {
    async isOwnedByUser(userId, address) {
      const wallet = await prisma.walletAddress.findUnique({
        where: { address },
        select: { userId: true },
      });
      return wallet?.userId === userId;
    },
  };
}
