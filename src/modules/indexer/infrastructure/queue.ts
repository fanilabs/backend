import type { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { getConfig } from '../../../shared/config/index.js';
import { logger } from '../../../shared/logger/index.js';
import { getQueue, getQueueConnection, QueueName } from '../../../shared/queue/index.js';
import { getSorobanClient } from '../../../blockchain/soroban-client.js';
import { createPollContractEventsUseCase } from '../application/index.js';
import { createInProcessEventBus } from './in-process-event-bus.js';
import { createPrismaCheckpointRepository } from './prisma-checkpoint-repository.js';
import { createPrismaEventStore } from './prisma-event-store.js';
import { createSorobanEventSource } from './soroban-event-source.js';

const log = logger.child({ module: 'indexer-queue' });

export interface TrackedContractConfig {
  contractName: string;
  contractId: string | undefined;
}

interface PollJobData {
  contractName: string;
  contractId: string;
  network: string;
}

/**
 * Registers one repeatable BullMQ job per configured contract. Safe to call
 * on every process start — BullMQ upserts a repeatable job by its
 * `(name, repeat options, jobId)` combination rather than duplicating it, so
 * this doesn't need its own "have I already scheduled this" bookkeeping.
 * Contracts with no id configured (the default — see .env.example) are
 * logged and skipped, not treated as an error.
 */
export async function scheduleIndexerPolling(contracts: TrackedContractConfig[]): Promise<void> {
  const config = getConfig();
  const queue = getQueue(QueueName.BlockchainIndexer);

  for (const contract of contracts) {
    if (!contract.contractId) {
      log.warn(
        { contractName: contract.contractName },
        'No contract id configured — skipping poll schedule',
      );
      continue;
    }

    const data: PollJobData = {
      contractName: contract.contractName,
      contractId: contract.contractId,
      network: config.STELLAR_NETWORK,
    };

    await queue.add('poll-contract', data, {
      jobId: `poll-${contract.contractName}`,
      repeat: { every: config.INDEXER_POLL_INTERVAL_MS },
    });

    log.info({ contractName: contract.contractName }, 'Scheduled indexer polling');
  }
}

/**
 * BullMQ Worker that processes the repeatable polling jobs — runs in the
 * worker process (src/workers/index.ts), not the API process.
 */
export function createIndexerWorker(prisma: PrismaClient): Worker {
  const pollContractEvents = createPollContractEventsUseCase({
    checkpointRepository: createPrismaCheckpointRepository(prisma),
    eventStore: createPrismaEventStore(prisma),
    eventSource: createSorobanEventSource(getSorobanClient()),
    eventPublisher: createInProcessEventBus(),
  });

  return new Worker<PollJobData>(
    QueueName.BlockchainIndexer,
    async (job) => {
      const result = await pollContractEvents(job.data);
      log.debug(
        {
          contractName: job.data.contractName,
          eventsFetched: result.eventsFetched,
          eventsInserted: result.eventsInserted,
          // Pino's JSON serializer can't handle bigint directly.
          lastLedgerSeq: result.lastLedgerSeq.toString(),
        },
        'Poll cycle complete',
      );
      return { ...result, lastLedgerSeq: result.lastLedgerSeq.toString() };
    },
    { connection: getQueueConnection() },
  );
}
