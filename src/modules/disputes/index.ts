import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import { accessSync, constants, mkdirSync } from 'node:fs';
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
  subscribeDisputeEventSync,
} from './infrastructure/index.js';
import { createDisputeRoutes } from './interface/routes.js';
import type { DisputeContractReader, DisputeTransactionBuilder } from './domain/index.js';

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

/**
 * Fails fast at boot rather than on the first evidence upload — the
 * historical bug here was a root-owned `/app/storage/evidence` that the
 * `node` user couldn't `mkdir` into, which only surfaced as an unmapped 500
 * on `POST /disputes/:id/evidence` the first time someone actually tried to
 * upload something. Consistent with the fail-fast posture env.ts already
 * applies to missing/invalid configuration (docs/DEPLOYMENT.md).
 */
function assertEvidenceStorageWritable(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `EVIDENCE_STORAGE_DIR (${dir}) is not writable by the running process — dispute evidence ` +
        `uploads would fail on first use. Fix directory ownership/permissions before starting ` +
        `(see docs/DEPLOYMENT.md § Health Checks). Underlying error: ${reason}`,
    );
  }
}

export function createDisputesModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  assertEvidenceStorageWritable(config.EVIDENCE_STORAGE_DIR);
  const disputeRepository = createPrismaDisputeRepository(prisma);
  const evidenceRepository = createPrismaEvidenceRepository(prisma);
  const evidenceStorage = createLocalEvidenceStorage(config.EVIDENCE_STORAGE_DIR);
  const walletOwnershipRepository = createPrismaWalletOwnershipRepository(prisma);
  const contractClient = config.DISPUTE_RESOLUTION_CONTRACT_ID
    ? createSorobanDisputeContractClient(getSorobanClient(), config.DISPUTE_RESOLUTION_CONTRACT_ID)
    : createUnconfiguredContractClient();

  const syncDisputeFromEvent = createSyncDisputeFromEventUseCase({ disputeRepository });
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
