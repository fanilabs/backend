import { Worker } from 'bullmq';
import { getQueue, getQueueConnection, QueueName } from '../../../shared/queue/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSendNotificationUseCase } from '../application/index.js';
import type { NotificationJobScheduler } from '../domain/index.js';

const log = logger.child({ module: 'notifications-queue' });

interface SendNotificationJobData {
  notificationId: string;
}

/** Producer-side `NotificationJobScheduler` — enqueues onto the shared
 * `notifications` BullMQ queue (`src/shared/queue/queues.ts`), consumed by
 * `createNotificationsWorker` below in the worker process
 * (`src/workers/index.ts`), never in the API process. */
export function createNotificationJobScheduler(): NotificationJobScheduler {
  const queue = getQueue(QueueName.Notifications);
  return {
    async enqueueDelivery(notificationId) {
      const data: SendNotificationJobData = { notificationId };
      // Explicit per-job retry policy (mirrors the queue-level
      // `defaultJobOptions` in `src/shared/queue/queues.ts`): transient
      // email-provider failures (429 rate limits, 503 outages) back off
      // exponentially instead of retrying immediately or not at all (#358).
      await queue.add('send-notification', data, {
        jobId: `send-${notificationId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    },
  };
}

/**
 * BullMQ Worker that processes queued delivery jobs — runs in the worker
 * process. `jobId: send-${notificationId}` (set above) makes re-enqueuing
 * the same notification a harmless no-op rather than a duplicate send,
 * BullMQ's own job-id dedup doing the same job the indexer's checkpoint
 * table does for blockchain events.
 */
export function createNotificationsWorker(
  sendNotification: ReturnType<typeof createSendNotificationUseCase>,
): Worker {
  return new Worker<SendNotificationJobData>(
    QueueName.Notifications,
    async (job) => {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      await sendNotification({ notificationId: job.data.notificationId, isFinalAttempt });
      log.debug({ notificationId: job.data.notificationId }, 'Notification delivered');
    },
    { connection: getQueueConnection() },
  );
}
