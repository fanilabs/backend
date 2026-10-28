import type { PrismaClient } from '@prisma/client';
import { createSyncDisputeFromEventUseCase } from './application/sync-dispute-from-event.js';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import { createPrismaDisputeRepository } from './infrastructure/prisma-dispute-repository.js';
import { createPrismaWalletOwnershipRepository } from './infrastructure/prisma-wallet-ownership-repository.js';
import { createSorobanEscrowStateReader } from './infrastructure/soroban-escrow-state-reader.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createDisputeEventConsumer(prisma: PrismaClient) {
  const config = getConfig();
  const escrowStateReader = config.ESCROW_CONTRACT_ID
    ? createSorobanEscrowStateReader(getSorobanClient(), config.ESCROW_CONTRACT_ID)
    : {
        getEscrowStatus: async (): Promise<never> => {
          throw new BlockchainError('ESCROW_CONTRACT_ID is not configured');
        },
      };
  return createSyncDisputeFromEventUseCase({
    disputeRepository: createPrismaDisputeRepository(prisma),
    walletOwnershipRepository: createPrismaWalletOwnershipRepository(prisma),
    escrowStateReader,
  });
}
