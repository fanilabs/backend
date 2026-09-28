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

    async findOwnerByAddress(address, asOf) {
      // `address` is unique, but `findUnique` can't take an extra filter
      // alongside a unique field — `findFirst` can. `verifiedAt: { lte: asOf }`
      // naturally excludes a null `verifiedAt` too (SQL's `NULL <= x` is
      // never true), which is the conservative behavior we want.
      const wallet = await prisma.walletAddress.findFirst({
        where: { address, verifiedAt: { lte: asOf } },
        select: { userId: true },
      });
      return wallet?.userId ?? null;
    },
  };
}
