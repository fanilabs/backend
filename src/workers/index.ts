import { createWorkerEventConsumers } from './event-consumers.js';
import type { ConsumerRegistry } from '../modules/indexer/index.js';
import {
  createFraudDetectionCleanupBackgroundWorker,
  scheduleFraudDetectionCleanup,
} from '../modules/fraud-detection/index.js';
import type { Worker } from 'bullmq';
import closeWithGrace from 'close-with-grace';
import { logger } from '../shared/logger/index.js';
import { getPrismaClient, disconnectPrisma } from '../shared/database/index.js';
import { disconnectRedis } from '../shared/cache/index.js';
import { disconnectQueueConnection, closeAllQueues } from '../shared/queue/index.js';
import { createIndexerBackgroundWorker, scheduleIndexer } from '../modules/indexer/index.js';
import { HEARTBEAT_INTERVAL_MS, createHeartbeatController } from './heartbeat.js';
import { executeWorkerShutdownSteps } from './shutdown.js';

const log = logger.child({ process: 'worker' });

/**
 * Registry of BullMQ Workers for the background-processing entrypoint
 * (ARCHITECTURE.md §4 — runs as a separate process/container from the API,
 * per the Phase 2 §5.3 lesson that in-process cron doesn't survive restarts
 * or scale horizontally). Each module contributes its own worker(s) here as
 * it's implemented in Phase 5.
 */
export const registerWorkers: Array<(consumers: ConsumerRegistry) => Worker> = [
  (consumers) => createIndexerBackgroundWorker(getPrismaClient(), consumers),
  // Notification delivery remains gated: ambiguous SMTP outcomes lack recovery.
  () => createFraudDetectionCleanupBackgroundWorker(getPrismaClient()),
];

async function main(): Promise<void> {
  const consumers = createWorkerEventConsumers(getPrismaClient());
  log.warn(
    { eventConsumers: consumers.describe() },
    'Event consumers registered; execution blocked',
  );
  // Repeatable job registration is idempotent (BullMQ upserts by
  // name+repeat+jobId) — safe to call on every worker-process start.
  await scheduleIndexer();
  await scheduleFraudDetectionCleanup();

  const workers = registerWorkers.map((register) => register(consumers));

  // Every teardown step runs with its own timeout and best-effort, so a Redis
  // that died alongside this container can't hang `worker.close()`/`queue.close()`
  // past the orchestrator grace period — see ./shutdown.js (#355).
  const { close: closeGracefully } = closeWithGrace(
    { delay: 10_000 },
    async ({ err }: { err?: Error }) => {
      clearInterval(heartbeatTimer);
      if (err) {
        log.error({ err }, 'Shutting down worker process due to unhandled error');
      } else {
        log.info('Shutting down worker process gracefully');
      }
      const shutdownErrors = await executeWorkerShutdownSteps({
        workers,
        closeAllQueues,
        disconnectPrisma,
        disconnectRedis,
        disconnectQueueConnection,
      });
      if (shutdownErrors.length > 0) {
        log.error(
          { errorCount: shutdownErrors.length, firstError: shutdownErrors[0] },
          'Errors during worker shutdown',
        );
      }
    },
  );

  // A heartbeat write that keeps failing (read-only filesystem, full disk)
  // triggers the same graceful-shutdown path as SIGTERM instead of leaving
  // the container to be killed as unhealthy with no diagnostic — see
  // ./heartbeat.js and docs/DEPLOYMENT.md § Health Checks (#357).
  const heartbeat = createHeartbeatController(() => closeGracefully());
  await heartbeat.write();
  const heartbeatTimer = setInterval(() => {
    void heartbeat.write();
  }, HEARTBEAT_INTERVAL_MS);

  log.info({ workerCount: workers.length }, 'Worker process started');
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'Failed to start worker process');
  process.exit(1);
});
