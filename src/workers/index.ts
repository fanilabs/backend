import type { Worker } from 'bullmq';
import closeWithGrace from 'close-with-grace';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger/index.js';
import { getPrismaClient, disconnectPrisma } from '../shared/database/index.js';
import { disconnectRedis } from '../shared/cache/index.js';
import { disconnectQueueConnection, closeAllQueues } from '../shared/queue/index.js';
import { createIndexerBackgroundWorker, scheduleIndexer } from '../modules/indexer/index.js';
import { createDeliveriesModule } from '../modules/deliveries/index.js';
import { createEscrowModule } from '../modules/escrow/index.js';
import { createFleetModule } from '../modules/fleet/index.js';
import { createDisputesModule } from '../modules/disputes/index.js';
import { createReputationModule } from '../modules/reputation/index.js';
import {
  createNotificationsBackgroundWorker,
  createNotificationsModule,
} from '../modules/notifications/index.js';
import {
  createFraudDetectionCleanupBackgroundWorker,
  createFraudDetectionModule,
  scheduleFraudDetectionCleanup,
} from '../modules/fraud-detection/index.js';

const log = logger.child({ process: 'worker' });

/**
 * The worker process has no HTTP surface, so `Dockerfile`'s worker
 * HEALTHCHECK can't probe it the way the api image probes `GET /health`.
 * Instead this touches a marker file on an interval; the HEALTHCHECK
 * considers the process wedged if the file's mtime falls too far behind —
 * see docs/DEPLOYMENT.md § Health Checks.
 */
const HEARTBEAT_DIR = process.env.WORKER_HEARTBEAT_DIR ?? '/var/lib/fanilab/heartbeat';
const HEARTBEAT_FILE = path.join(HEARTBEAT_DIR, 'worker.heartbeat');
const HEARTBEAT_INTERVAL_MS = 15_000;

async function writeHeartbeat(): Promise<void> {
  try {
    await mkdir(HEARTBEAT_DIR, { recursive: true });
    await writeFile(HEARTBEAT_FILE, new Date().toISOString());
  } catch (err) {
    log.warn({ err }, 'Failed to write worker heartbeat file');
  }
}

/**
 * Registry of BullMQ Workers for the background-processing entrypoint
 * (ARCHITECTURE.md §4 — runs as a separate process/container from the API,
 * per the Phase 2 §5.3 lesson that in-process cron doesn't survive restarts
 * or scale horizontally). Each module contributes its own worker(s) here as
 * it's implemented in Phase 5.
 */
const registerWorkers: Array<() => Worker> = [
  () => createIndexerBackgroundWorker(getPrismaClient()),
  () => createNotificationsBackgroundWorker(getPrismaClient()),
  () => createFraudDetectionCleanupBackgroundWorker(getPrismaClient()),
];

/**
 * Every module that reacts to blockchain events (`subscribeXEventSync` /
 * `subscribeNotificationsEventDispatch`, wired as a side effect inside each
 * `createXModule` factory) must have that factory called from *this*
 * process, not just `app.ts`'s. The indexer's poll job — the only thing
 * that ever calls `publishBlockchainEvent` — runs here, in the worker
 * process (`createIndexerBackgroundWorker` above); the in-process event bus
 * it publishes to (`shared/events`) is a plain `EventEmitter`, invisible
 * across the `api`/`worker` process boundary `docker-compose.yml` actually
 * deploys. `app.ts` also constructs every module (for its HTTP routes,
 * which *does* need to run there), which harmlessly wires a second,
 * never-triggered subscription in that process — redundant, not wrong,
 * since the API process never publishes anything. The returned Fastify
 * plugins are intentionally discarded here; this process has no HTTP server.
 */
const wireModuleEventSubscriptions: Array<() => void> = [
  () => void createDeliveriesModule(getPrismaClient()),
  () => void createEscrowModule(getPrismaClient()),
  () => void createFleetModule(getPrismaClient()),
  () => void createDisputesModule(getPrismaClient()),
  () => void createReputationModule(getPrismaClient()),
  () => void createNotificationsModule(getPrismaClient()),
  () => void createFraudDetectionModule(getPrismaClient()),
];

async function main(): Promise<void> {
  // Repeatable job registration is idempotent (BullMQ upserts by
  // name+repeat+jobId) — safe to call on every worker-process start.
  await scheduleIndexer();
  await scheduleFraudDetectionCleanup();

  wireModuleEventSubscriptions.forEach((wire) => wire());

  const workers = registerWorkers.map((register) => register());

  await writeHeartbeat();
  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  closeWithGrace({ delay: 10_000 }, async ({ err }: { err?: Error }) => {
    clearInterval(heartbeatTimer);
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
