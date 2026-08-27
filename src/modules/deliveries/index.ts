import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import {
  createBuildDeliveryTransactionsUseCases,
  createGetDeliveryUseCase,
  createListDeliveriesUseCase,
  createSyncDeliveryFromEventUseCase,
} from './application/index.js';
import {
  createPrismaDeliveryRepository,
  createSorobanDeliveryContractClient,
  subscribeDeliveryEventSync,
} from './infrastructure/index.js';
import { createDeliveriesRoutes } from './interface/routes.js';
import type { DeliveryContractReader, DeliveryTransactionBuilder } from './domain/index.js';

/** Every method throws a clear, actionable error instead of the module
 * failing to boot — consistent with the indexer's "skip if not configured"
 * handling for contracts with no id set yet (.env.example leaves
 * DELIVERY_CONTRACT_ID blank by default). */
function createUnconfiguredContractClient(): DeliveryContractReader & DeliveryTransactionBuilder {
  const fail = (): never => {
    throw new BlockchainError(
      'DELIVERY_CONTRACT_ID is not configured — this environment has no delivery_contract deployment to call.',
    );
  };
  return {
    getDelivery: fail,
    buildCreateDelivery: fail,
    buildAssignDriver: fail,
    buildMarkInTransit: fail,
    buildConfirmDelivery: fail,
    buildCancelDelivery: fail,
    buildRaiseDispute: fail,
  };
}

export function createDeliveriesModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const deliveryRepository = createPrismaDeliveryRepository(prisma);
  const contractClient = config.DELIVERY_CONTRACT_ID
    ? createSorobanDeliveryContractClient(getSorobanClient(), config.DELIVERY_CONTRACT_ID)
    : createUnconfiguredContractClient();

  const syncDeliveryFromEvent = createSyncDeliveryFromEventUseCase({
    deliveryRepository,
    contractReader: contractClient,
  });
  subscribeDeliveryEventSync(syncDeliveryFromEvent);

  const useCases = {
    listDeliveries: createListDeliveriesUseCase({ deliveryRepository }),
    getDelivery: createGetDeliveryUseCase({ deliveryRepository }),
    buildTransactions: createBuildDeliveryTransactionsUseCases({
      transactionBuilder: contractClient,
    }),
  };

  return createDeliveriesRoutes(useCases);
}
