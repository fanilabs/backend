import type { ConsumerRegistry } from '../application/consumer-registry.js';
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
 * Explicit BullMQ worker options for the indexer poll worker (#356) — the
 * library defaults (`concurrency: 1`, 30s lock) left the lock duration
 * shorter than a legitimate catch-up poll over a slow RPC, which made
 * BullMQ mark the job stalled mid-run and start a duplicate poll in
 * parallel. Concurrent polls against the same Soroban RPC can ingest events
 * out of order and corrupt the monotonic `blockchain_events` sequence the
 * checkpoint table guarantees, so:
 *
 * - `concurrency: 1` — polls must never overlap, period.
 * - `lockDuration: 60_000` — covers the worst-case poll tick; BullMQ
 *   auto-renews the lock at half this interval for the life of the job, so
 *   long batch processing stays safe without any application-side code.
 * - `stalledInterval: 30_000` — how often the worker checks for expired
 *   locks; a job only counts as stalled once its 60s lock has lapsed.
 * - `maxStalledCount: 2` — tolerate a couple of genuine stalls (e.g. an RPC
 *   pause during a deployment) before failing the job outright.
 */
export const indexerWorkerOptions = {
  concurrency: 1,
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
} as const;

/**
 * BullMQ Worker that processes the repeatable polling jobs — runs in the
 * worker process (src/workers/index.ts), not the API process.
 */
export function createIndexerWorker(prisma: PrismaClient, consumers: ConsumerRegistry): Worker {
  const pollContractEvents = createPollContractEventsUseCase({
    checkpointRepository: createPrismaCheckpointRepository(prisma),
    eventStore: createPrismaEventStore(prisma),
    eventSource: createSorobanEventSource(getSorobanClient()),
    eventPublisher: createInProcessEventBus(),
    retentionWindowLedgers: getConfig().INDEXER_EVENT_RETENTION_LEDGERS,
  });

  return new Worker<PollJobData>(
    QueueName.BlockchainIndexer,
    async (job) => {
      // Fail before fetching, publication or checkpoint writes. The legacy bus
      // cannot acknowledge required consumers and must not bypass this gate.
      consumers.assertCanProcessContract(job.data.contractName);
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
    { connection: getQueueConnection(), ...indexerWorkerOptions },
  );
}
