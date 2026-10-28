import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Worker } from 'bullmq';
import {
  createAssessActorUseCase,
  createRecordActorActivityFromEventUseCase,
} from './application/index.js';
import {
  createFraudActivityCleanupWorker,
  createLedgerClock,
  createPrismaActorActivityRepository,
  scheduleFraudActivityCleanup,
  subscribeFraudDetectionEventDispatch,
} from './infrastructure/index.js';
import { createFraudDetectionRoutes } from './interface/routes.js';
import { getConfig } from '../../shared/config/index.js';

/**
 * Unlike `notifications`, this module writes synchronously in its event
 * handler rather than through a BullMQ queue — a single fast `INSERT` has
 * no failure-prone external channel to isolate the handler from, the same
 * direct-write pattern `deliveries`/`escrow`/`disputes`/`reputation`/`fleet`
 * already use for their own read-model syncs. No separate background
 * worker as a result — just this one composition root, called from both
 * `app.ts` (for the routes) and `src/workers/index.ts` (for the
 * subscription to actually fire — see that file's header comment).
 */
export function createFraudDetectionModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const config = getConfig();
  const activityRepository = createPrismaActorActivityRepository(prisma);

  const recordActorActivityFromEvent = createRecordActorActivityFromEventUseCase({
    activityRepository,
  });
  subscribeFraudDetectionEventDispatch(recordActorActivityFromEvent);

  const useCases = {
    assessActor: createAssessActorUseCase({
      activityRepository,
      clock: createLedgerClock(prisma),
      ruleDefinitions: [
        {
          ruleType: 'DELIVERY_CREATION_VELOCITY',
          category: 'DELIVERY_CREATED',
          threshold: config.FRAUD_DELIVERY_VELOCITY_THRESHOLD,
          windowHours: config.FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS,
        },
        {
          ruleType: 'ESCROW_RELEASE_VELOCITY',
          category: 'ESCROW_RELEASED',
          threshold: config.FRAUD_ESCROW_VELOCITY_THRESHOLD,
          windowHours: config.FRAUD_ESCROW_VELOCITY_WINDOW_HOURS,
        },
        {
          ruleType: 'DISPUTE_RAISE_VELOCITY',
          category: 'DISPUTE_RAISED',
          threshold: config.FRAUD_DISPUTE_VELOCITY_THRESHOLD,
          windowHours: config.FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS,
        },
      ],
    }),
  };

  return createFraudDetectionRoutes(useCases);
}

/** Called once at worker-process startup — see src/workers/index.ts. */
export async function scheduleFraudDetectionCleanup(): Promise<void> {
  await scheduleFraudActivityCleanup();
}

/** Called once at worker-process startup to create the BullMQ Worker that
 * actually runs the scheduled retention cleanup — see src/workers/index.ts. */
export function createFraudDetectionCleanupBackgroundWorker(prisma: PrismaClient): Worker {
  return createFraudActivityCleanupWorker(prisma);
}
