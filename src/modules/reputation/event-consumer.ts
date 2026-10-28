import type { PrismaClient } from '@prisma/client';
import { createSyncReputationFromEventUseCase } from './application/sync-reputation-from-event.js';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import { createPrismaDriverProfileRepository } from './infrastructure/prisma-driver-profile-repository.js';
import { createSorobanReputationContractClient } from './infrastructure/soroban-reputation-contract-client.js';
import { createDeliveryLegacyProfileReader } from './infrastructure/delivery-legacy-profile-reader.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createReputationEventConsumer(prisma: PrismaClient) {
  const config = getConfig();
  const contractReader = config.IDENTITY_REPUTATION_CONTRACT_ID
    ? createSorobanReputationContractClient(
        getSorobanClient(),
        config.IDENTITY_REPUTATION_CONTRACT_ID,
      )
    : {
        getDriverProfile: async (): Promise<never> => {
          throw new BlockchainError('IDENTITY_REPUTATION_CONTRACT_ID is not configured');
        },
      };
  const legacyReader = config.DELIVERY_CONTRACT_ID
    ? createDeliveryLegacyProfileReader(getSorobanClient(), config.DELIVERY_CONTRACT_ID)
    : {
        getLegacyDeliveriesCompleted: async (): Promise<never> => {
          throw new BlockchainError('DELIVERY_CONTRACT_ID is not configured');
        },
      };
  return createSyncReputationFromEventUseCase({
    driverProfileRepository: createPrismaDriverProfileRepository(prisma),
    contractReader,
    legacyReader,
  });
}
