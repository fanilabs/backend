import type { Worker } from 'bullmq';
import closeWithGrace from 'close-with-grace';
import { logger } from '../shared/logger/index.js';
import { getPrismaClient, disconnectPrisma } from '../shared/database/index.js';
import { disconnectRedis } from '../shared/cache/index.js';
import { disconnectQueueConnection, closeAllQueues } from '../shared/queue/index.js';
import { createIndexerBackgroundWorker, scheduleIndexer } from '../modules/indexer/index.js';

const log = logger.child({ process: 'worker' });

/**
 * Registry of BullMQ Workers for the background-processing entrypoint
 * (ARCHITECTURE.md §4 — runs as a separate process/container from the API,
 * per the Phase 2 §5.3 lesson that in-process cron doesn't survive restarts
 * or scale horizontally). Each module contributes its own worker(s) here as
 * it's implemented in Phase 5.
 */
const registerWorkers: Array<() => Worker> = [
  () => createIndexerBackgroundWorker(getPrismaClient()),
];

async function main(): Promise<void> {
  // Repeatable job registration is idempotent (BullMQ upserts by
  // name+repeat+jobId) — safe to call on every worker-process start.
  await scheduleIndexer();

  const workers = registerWorkers.map((register) => register());

  closeWithGrace({ delay: 10_000 }, async ({ err }: { err?: Error }) => {
    if (err) {
      log.error({ err }, 'Shutting down worker process due to unhandled error');
    } else {
      log.info('Shutting down worker process gracefully');
    }
    await Promise.all(workers.map((worker) => worker.close()));
    await closeAllQueues();
    await Promise.all([disconnectPrisma(), disconnectRedis(), disconnectQueueConnection()]);
  });

  log.info({ workerCount: workers.length }, 'Worker process started');
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'Failed to start worker process');
  process.exit(1);
});
