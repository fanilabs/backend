import type { PrismaClient } from '@prisma/client';
import { createSyncDeliveryFromEventUseCase } from './application/sync-delivery-from-event.js';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import { createPrismaDeliveryRepository } from './infrastructure/prisma-delivery-repository.js';
import { createSorobanDeliveryContractClient } from './infrastructure/soroban-delivery-contract-client.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createDeliveryEventConsumer(prisma: PrismaClient) {
  const config = getConfig();
  const contractReader = config.DELIVERY_CONTRACT_ID
    ? createSorobanDeliveryContractClient(getSorobanClient(), config.DELIVERY_CONTRACT_ID)
    : {
        getDelivery: async () => {
          throw new BlockchainError('DELIVERY_CONTRACT_ID is not configured');
        },
      };
  return createSyncDeliveryFromEventUseCase({
    deliveryRepository: createPrismaDeliveryRepository(prisma),
    contractReader,
  });
}

// Verified status-mutation adapter is available for a future durable executor.
// Exporting it does not approve execution or creation hydration in the registry.
export { createAtomicDeliveryStatusConsumer } from './infrastructure/atomic-delivery-consumer.js';
