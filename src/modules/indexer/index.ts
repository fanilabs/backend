import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Worker } from 'bullmq';
import { getConfig } from '../../shared/config/index.js';
import { getSorobanClient } from '../../blockchain/soroban-client.js';
import { createGetIndexerHealthUseCase } from './application/index.js';
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
 * Minimal indexer scope for this phase (ROADMAP.md §5): escrow + delivery
 * contracts only, enough to unblock the `deliveries` and `escrow` modules
 * next. The remaining four contracts are added here when their consuming
 * modules (fleet, disputes, reputation) are implemented — not before.
 */
function getTrackedContracts(): TrackedContractConfig[] {
  const config = getConfig();
  return [
    { contractName: 'escrow', contractId: config.ESCROW_CONTRACT_ID },
    { contractName: 'delivery', contractId: config.DELIVERY_CONTRACT_ID },
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
