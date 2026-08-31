import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import {
  createBuildEscrowTransactionsUseCases,
  createGetEscrowUseCase,
  createSyncEscrowFromEventUseCase,
} from './application/index.js';
import {
  createPrismaEscrowRepository,
  createSorobanEscrowContractClient,
  subscribeEscrowEventSync,
} from './infrastructure/index.js';
import { createEscrowRoutes } from './interface/routes.js';
import type { EscrowContractReader, EscrowTransactionBuilder } from './domain/index.js';

/** Same "fail loudly, not at boot" fallback as
 * deliveries/index.ts's createUnconfiguredContractClient — used when
 * ESCROW_CONTRACT_ID is left blank (.env.example default). */
function createUnconfiguredContractClient(): EscrowContractReader & EscrowTransactionBuilder {
  const fail = (): never => {
    throw new BlockchainError(
      'ESCROW_CONTRACT_ID is not configured — this environment has no escrow_contract deployment to call.',
    );
  };
  return {
    getEscrow: fail,
    buildCreateEscrow: fail,
    buildReleaseEscrow: fail,
    buildRefundEscrow: fail,
  };
}

export function createEscrowModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const escrowRepository = createPrismaEscrowRepository(prisma);
  const contractClient = config.ESCROW_CONTRACT_ID
    ? createSorobanEscrowContractClient(getSorobanClient(), config.ESCROW_CONTRACT_ID)
    : createUnconfiguredContractClient();

  const syncEscrowFromEvent = createSyncEscrowFromEventUseCase({
    escrowRepository,
    contractReader: contractClient,
  });
  subscribeEscrowEventSync(syncEscrowFromEvent);

  const useCases = {
    getEscrow: createGetEscrowUseCase({ escrowRepository }),
    buildTransactions: createBuildEscrowTransactionsUseCases({
      transactionBuilder: contractClient,
    }),
  };

  return createEscrowRoutes(useCases);
}
