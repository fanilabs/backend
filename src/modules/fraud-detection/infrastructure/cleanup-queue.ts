import type { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { getConfig } from '../../../shared/config/index.js';
import { logger } from '../../../shared/logger/index.js';
import { getQueue, getQueueConnection, QueueName } from '../../../shared/queue/index.js';
import { createPrismaActorActivityRepository } from './prisma-actor-activity-repository.js';

const log = logger.child({ module: 'fraud-activity-cleanup-queue' });

/** Rows are deleted in batches of at most this size per iteration — see
 * `ActorActivityRepository.deleteOlderThan`'s header comment for why. */
const DELETE_BATCH_SIZE = 1_000;

const CLEANUP_JOB_ID = 'fraud-activity-cleanup';
/** Once a day is comfortably frequent enough for a retention window
 * measured in days — this is background hygiene, not a latency-sensitive
 * job. */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Registers the repeatable retention-cleanup job. Safe to call on every
 * worker-process start — BullMQ upserts a repeatable job by its
 * `(name, repeat options, jobId)` combination, same as
 * `modules/indexer/infrastructure/queue.ts`'s own `scheduleIndexerPolling`.
 */
export async function scheduleFraudActivityCleanup(): Promise<void> {
  const queue = getQueue(QueueName.FraudActivityCleanup);
  await queue.add(
    'cleanup',
    {},
    { jobId: CLEANUP_JOB_ID, repeat: { every: CLEANUP_INTERVAL_MS } },
  );
  log.info('Scheduled fraud activity retention cleanup');
}

/**
 * BullMQ Worker that deletes `actor_activities` rows older than
 * `FRAUD_ACTIVITY_RETENTION_DAYS` — runs in the worker process
 * (src/workers/index.ts), not the API process. Deletion is batched
 * (`ActorActivityRepository.deleteOlderThan`) so it can't hold a long
 * table lock, and the retention window is always comfortably wider than
 * every current rule window (max 24h, see `application/assess-actor.ts`),
 * so scheduled deletion never affects a live assessment.
 */
export function createFraudActivityCleanupWorker(prisma: PrismaClient): Worker {
  const activityRepository = createPrismaActorActivityRepository(prisma);

  return new Worker(
    QueueName.FraudActivityCleanup,
    async () => {
      const retentionDays = getConfig().FRAUD_ACTIVITY_RETENTION_DAYS;
      const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const deletedCount = await activityRepository.deleteOlderThan(olderThan, DELETE_BATCH_SIZE);
      log.info({ deletedCount, retentionDays }, 'Fraud activity retention cleanup complete');
      return { deletedCount };
    },
    { connection: getQueueConnection() },
  );
}
