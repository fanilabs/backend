import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import {
  createBuildReputationTransactionsUseCases,
  createGetDriverProfileUseCase,
  createSyncReputationFromEventUseCase,
} from './application/index.js';
import {
  createDeliveryLegacyProfileReader,
  createPrismaDriverProfileRepository,
  createSorobanReputationContractClient,
  subscribeReputationEventSync,
} from './infrastructure/index.js';
import { createReputationRoutes } from './interface/routes.js';
import type {
  LegacyDriverProfileReader,
  ReputationContractReader,
  ReputationTransactionBuilder,
} from './domain/index.js';

/** Same "fail loudly, not at boot" fallback as every other module's
 * createUnconfiguredContractClient — used when IDENTITY_REPUTATION_CONTRACT_ID
 * is left blank (.env.example default). */
function createUnconfiguredContractClient(): ReputationContractReader &
  ReputationTransactionBuilder {
  const fail = (): never => {
    throw new BlockchainError(
      'IDENTITY_REPUTATION_CONTRACT_ID is not configured — this environment has no identity_reputation_contract deployment to call.',
    );
  };
  return {
    getDriverProfile: fail,
    buildRegisterDriver: fail,
    buildUpdateDriverKycStatus: fail,
  };
}

/** Same rationale, for the secondary `delivery_contract` legacy-counter
 * read — a missing `DELIVERY_CONTRACT_ID` here is caught by
 * `sync-reputation-from-event.ts`'s own try/catch (it treats "unavailable"
 * the same whether the cause is "not configured" or "RPC error"), not
 * surfaced to an API caller, since nothing in this module's HTTP surface
 * calls it directly. */
function createUnconfiguredLegacyReader(): LegacyDriverProfileReader {
  return {
    getLegacyDeliveriesCompleted(): Promise<number> {
      return Promise.reject(
        new BlockchainError(
          'DELIVERY_CONTRACT_ID is not configured — cannot read the legacy driver profile counter.',
        ),
      );
    },
  };
}

export function createReputationModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const driverProfileRepository = createPrismaDriverProfileRepository(prisma);
  const contractClient = config.IDENTITY_REPUTATION_CONTRACT_ID
    ? createSorobanReputationContractClient(
        getSorobanClient(),
        config.IDENTITY_REPUTATION_CONTRACT_ID,
      )
    : createUnconfiguredContractClient();
  const legacyReader = config.DELIVERY_CONTRACT_ID
    ? createDeliveryLegacyProfileReader(getSorobanClient(), config.DELIVERY_CONTRACT_ID)
    : createUnconfiguredLegacyReader();

  const syncReputationFromEvent = createSyncReputationFromEventUseCase({
    driverProfileRepository,
    contractReader: contractClient,
    legacyReader,
  });
  subscribeReputationEventSync(syncReputationFromEvent);

  const useCases = {
    getDriverProfile: createGetDriverProfileUseCase({ driverProfileRepository }),
    buildTransactions: createBuildReputationTransactionsUseCases({
      transactionBuilder: contractClient,
    }),
  };

  return createReputationRoutes(useCases);
}
