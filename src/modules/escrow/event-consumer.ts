import type { PrismaClient } from '@prisma/client';
import { createSyncEscrowFromEventUseCase } from './application/sync-escrow-from-event.js';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import { createPrismaEscrowRepository } from './infrastructure/prisma-escrow-repository.js';
import { createSorobanEscrowContractClient } from './infrastructure/soroban-escrow-contract-client.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createEscrowEventConsumer(prisma: PrismaClient) {
  const config = getConfig();
  const contractReader = config.ESCROW_CONTRACT_ID
    ? createSorobanEscrowContractClient(getSorobanClient(), config.ESCROW_CONTRACT_ID)
    : {
        getEscrow: async () => {
          throw new BlockchainError('ESCROW_CONTRACT_ID is not configured');
        },
      };
  return createSyncEscrowFromEventUseCase({
    escrowRepository: createPrismaEscrowRepository(prisma),
    contractReader,
    ...(config.ALLOWED_PAYMENT_TOKENS.length
      ? { allowedTokens: config.ALLOWED_PAYMENT_TOKENS }
      : {}),
    logger,
  });
}
