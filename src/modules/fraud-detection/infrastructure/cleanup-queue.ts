import type { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { getConfig } from '../../../shared/config/index.js';
import { logger } from '../../../shared/logger/index.js';
import { getQueue, getQueueConnection, QueueName } from '../../../shared/queue/index.js';

const log = logger.child({ module: 'fraud-activity-cleanup-queue' });

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
  await queue.add('cleanup', {}, { jobId: CLEANUP_JOB_ID, repeat: { every: CLEANUP_INTERVAL_MS } });
  log.info('Scheduled fraud activity retention cleanup');
}

/**
 * Fail closed until the indexer supplies a reliable durable processing frontier.
 * Existing checkpoints can advance past unread pages or failed subscribers;
 * blockchain_events.processedAt has no production writer. The evaluator's
 * latest-observed-event clock is also not proof of successful processing.
 * None is safe evidence that deleting activity preserves active evaluations.
 *
 * Keep the factory's Prisma argument for production composition compatibility,
 * but deliberately perform no query or deletion. Re-enabling cleanup requires
 * a verified frontier and the bounded batch/progress/continuation contract,
 * not merely adding a database timestamp or trusting job-supplied metadata.
 */
export function createFraudActivityCleanupWorker(_prisma: PrismaClient): Worker {
  // Validate retention/window configuration before creating a worker.
  getConfig();

  return new Worker(
    QueueName.FraudActivityCleanup,
    async () => {
      const result = {
        status: 'skipped',
        reason: 'reliable_processing_watermark_unavailable',
        deletedCount: 0,
        backlog: 'unknown',
        cutoff: null,
      } as const;
      log.warn(result, 'Fraud activity cleanup skipped: no trustworthy processing watermark');
      return result;
    },
    { connection: getQueueConnection() },
  );
}
