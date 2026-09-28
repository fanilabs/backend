import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Worker } from 'bullmq';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/soroban-client.js';
import { createGetIndexerHealthUseCase, type ContractHealth } from './application/index.js';
import {
  createPrismaCheckpointRepository,
  createSorobanEventSource,
} from './infrastructure/index.js';
import {
  createIndexerWorker,
  scheduleIndexerPolling,
  type TrackedContractConfig,
} from './infrastructure/queue.js';
import { createIndexerHealthRoutes } from './interface/routes.js';

/**
 * Indexer scope grows one module at a time (ROADMAP.md §5): all five
 * contracts with a consuming module — escrow, delivery, fleet,
 * dispute-resolution, and identity-reputation. `settlement_contract` is
 * deliberately never tracked here — it's an unimplemented stub with no
 * consuming module planned (PHASE_1_DOMAIN_ANALYSIS.md §8), not an
 * oversight.
 */
export function getTrackedContracts(): TrackedContractConfig[] {
  const config = getConfig();
  return [
    { contractName: 'escrow', contractId: config.ESCROW_CONTRACT_ID },
    { contractName: 'delivery', contractId: config.DELIVERY_CONTRACT_ID },
    { contractName: 'fleet', contractId: config.FLEET_MANAGEMENT_CONTRACT_ID },
    { contractName: 'dispute-resolution', contractId: config.DISPUTE_RESOLUTION_CONTRACT_ID },
    { contractName: 'identity-reputation', contractId: config.IDENTITY_REPUTATION_CONTRACT_ID },
  ];
}

export function createIndexerHealthPlugin(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const getIndexerHealth = createGetIndexerHealthUseCase({
    checkpointRepository: createPrismaCheckpointRepository(prisma),
    eventSource: createSorobanEventSource(getSorobanClient()),
  });

  return createIndexerHealthRoutes({
    getIndexerHealth,
    trackedContracts: getTrackedContracts(),
    network: config.STELLAR_NETWORK,
    lagAlertThreshold: config.INDEXER_LAG_ALERT_LEDGERS,
  });
}

/** Called once at worker-process startup — see src/workers/index.ts. */
export async function scheduleIndexer(): Promise<void> {
  await scheduleIndexerPolling(getTrackedContracts());
}

/** Called once at worker-process startup to create the BullMQ Worker that
 * actually runs the scheduled polls — see src/workers/index.ts. */
export function createIndexerBackgroundWorker(prisma: PrismaClient): Worker {
  return createIndexerWorker(prisma);
}

/**
 * Same construction as `createIndexerHealthPlugin`, minus the HTTP route —
 * for `/metrics` (`src/shared/metrics`) to read per-contract lag into a
 * Prometheus gauge without duplicating `GetIndexerHealthResult`'s logic.
 */
export async function getIndexerLagMetrics(prisma: PrismaClient): Promise<ContractHealth[]> {
  const config = getConfig();
  const getIndexerHealth = createGetIndexerHealthUseCase({
    checkpointRepository: createPrismaCheckpointRepository(prisma),
    eventSource: createSorobanEventSource(getSorobanClient()),
  });

  const result = await getIndexerHealth({
    network: config.STELLAR_NETWORK,
    trackedContracts: getTrackedContracts(),
    lagAlertThreshold: config.INDEXER_LAG_ALERT_LEDGERS,
  });

  return result.contracts;
}
