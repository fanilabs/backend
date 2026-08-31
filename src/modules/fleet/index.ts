import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import {
  createBuildFleetTransactionsUseCases,
  createGetFleetUseCase,
  createGetPayoutAddressUseCase,
  createSyncFleetFromEventUseCase,
} from './application/index.js';
import {
  createPrismaFleetRepository,
  createSorobanFleetContractClient,
  subscribeFleetEventSync,
} from './infrastructure/index.js';
import { createFleetRoutes } from './interface/routes.js';
import type { FleetContractReader, FleetTransactionBuilder } from './domain/index.js';

/** Same "fail loudly, not at boot" fallback as escrow/index.ts and
 * deliveries/index.ts's createUnconfiguredContractClient — used when
 * FLEET_MANAGEMENT_CONTRACT_ID is left blank (.env.example default). */
function createUnconfiguredContractClient(): FleetContractReader & FleetTransactionBuilder {
  const fail = (): never => {
    throw new BlockchainError(
      'FLEET_MANAGEMENT_CONTRACT_ID is not configured — this environment has no fleet_management_contract deployment to call.',
    );
  };
  return {
    getPayoutAddress: fail,
    buildRegisterFleet: fail,
    buildUpdateFleetTreasury: fail,
    buildAddDriverToFleet: fail,
    buildAcceptFleetInvite: fail,
    buildRemoveDriverFromFleet: fail,
  };
}

export function createFleetModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const fleetRepository = createPrismaFleetRepository(prisma);
  const contractClient = config.FLEET_MANAGEMENT_CONTRACT_ID
    ? createSorobanFleetContractClient(getSorobanClient(), config.FLEET_MANAGEMENT_CONTRACT_ID)
    : createUnconfiguredContractClient();

  const syncFleetFromEvent = createSyncFleetFromEventUseCase({ fleetRepository });
  subscribeFleetEventSync(syncFleetFromEvent);

  const useCases = {
    getFleet: createGetFleetUseCase({ fleetRepository }),
    getPayoutAddress: createGetPayoutAddressUseCase({ contractReader: contractClient }),
    buildTransactions: createBuildFleetTransactionsUseCases({
      transactionBuilder: contractClient,
    }),
  };

  return createFleetRoutes(useCases);
}
