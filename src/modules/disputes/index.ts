import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import {
  createBuildDisputeTransactionsUseCases,
  createDownloadEvidenceUseCase,
  createGetDisputeUseCase,
  createSyncDisputeFromEventUseCase,
  createUploadEvidenceUseCase,
} from './application/index.js';
import {
  createLocalEvidenceStorage,
  createPrismaDisputeRepository,
  createPrismaEvidenceRepository,
  createPrismaWalletOwnershipRepository,
  createSorobanDisputeContractClient,
  createSorobanEscrowStateReader,
  subscribeDisputeEventSync,
} from './infrastructure/index.js';
import { createDisputeRoutes } from './interface/routes.js';
import type {
  DisputeContractReader,
  DisputeEscrowStateReader,
  DisputeTransactionBuilder,
} from './domain/index.js';

/** Same "fail loudly, not at boot" fallback as escrow/fleet/deliveries'
 * createUnconfiguredContractClient — used when DISPUTE_RESOLUTION_CONTRACT_ID
 * is left blank (.env.example default). */
function createUnconfiguredContractClient(): DisputeContractReader & DisputeTransactionBuilder {
  const fail = (): never => {
    throw new BlockchainError(
      'DISPUTE_RESOLUTION_CONTRACT_ID is not configured — this environment has no dispute_resolution_contract deployment to call.',
    );
  };
  return {
    getDispute: fail,
    buildRaiseDispute: fail,
    buildAddEvidenceHash: fail,
    buildResolveDisputeRefundSender: fail,
    buildResolveDisputePayDriver: fail,
    buildResolveDisputeSplitFunds: fail,
  };
}

/** Same fallback shape as above, for the escrow-state reader added to
 * disambiguate `escrow.dispute_resolved` (see
 * `sync-dispute-from-event.ts`'s header comment) — used when
 * `ESCROW_CONTRACT_ID` is left blank. */
function createUnconfiguredEscrowStateReader(): DisputeEscrowStateReader {
  return {
    getEscrowStatus(): Promise<never> {
      return Promise.reject(
        new BlockchainError(
          'ESCROW_CONTRACT_ID is not configured — this environment has no escrow_contract deployment to call.',
        ),
      );
    },
  };
}

export function createDisputesModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const disputeRepository = createPrismaDisputeRepository(prisma);
  const evidenceRepository = createPrismaEvidenceRepository(prisma);
  const evidenceStorage = createLocalEvidenceStorage(config.EVIDENCE_STORAGE_DIR);
  const walletOwnershipRepository = createPrismaWalletOwnershipRepository(prisma);
  const contractClient = config.DISPUTE_RESOLUTION_CONTRACT_ID
    ? createSorobanDisputeContractClient(getSorobanClient(), config.DISPUTE_RESOLUTION_CONTRACT_ID)
    : createUnconfiguredContractClient();
  const escrowStateReader = config.ESCROW_CONTRACT_ID
    ? createSorobanEscrowStateReader(getSorobanClient(), config.ESCROW_CONTRACT_ID)
    : createUnconfiguredEscrowStateReader();

  const syncDisputeFromEvent = createSyncDisputeFromEventUseCase({
    disputeRepository,
    escrowStateReader,
  });
  subscribeDisputeEventSync(syncDisputeFromEvent);

  const useCases = {
    getDispute: createGetDisputeUseCase({
      disputeRepository,
      evidenceRepository,
      contractReader: contractClient,
    }),
    uploadEvidence: createUploadEvidenceUseCase({
      disputeRepository,
      evidenceRepository,
      evidenceStorage,
      walletOwnershipRepository,
    }),
    downloadEvidence: createDownloadEvidenceUseCase({
      evidenceRepository,
      evidenceStorage,
      disputeRepository,
      walletOwnershipRepository,
    }),
    buildTransactions: createBuildDisputeTransactionsUseCases({
      transactionBuilder: contractClient,
    }),
  };

  return createDisputeRoutes(useCases);
}
