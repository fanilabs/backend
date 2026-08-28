import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { Worker } from 'bullmq';
import { getConfig } from '../../shared/config/index.js';
import {
  createDispatchNotificationsFromEventUseCase,
  createGetNotificationUseCase,
  createListNotificationsUseCase,
  createSendNotificationUseCase,
} from './application/index.js';
import {
  createNotificationJobScheduler,
  createNotificationsWorker,
  createPrismaNotificationRepository,
  createPrismaUserContactLookup,
  selectNotificationSender,
  subscribeNotificationsEventDispatch,
} from './infrastructure/index.js';
import { createNotificationsRoutes } from './interface/routes.js';

/**
 * API-process composition root: wires the read-only `GET /notifications*`
 * routes, and — as a side effect, same as every other module's own
 * `createXModule` — subscribes `dispatchNotificationsFromEvent` to the
 * shared in-process event bus. That subscription only actually fires when
 * this factory runs in the same OS process as the indexer's poll job (the
 * worker process, not this one) — see `src/workers/index.ts`'s header
 * comment for the full explanation of why it's still called here too
 * (harmless, not redundant-in-a-bad-way: `app.ts` needs the routes this
 * returns regardless).
 */
export function createNotificationsModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const notificationRepository = createPrismaNotificationRepository(prisma);
  const userContactLookup = createPrismaUserContactLookup(prisma);
  const jobScheduler = createNotificationJobScheduler();

  const dispatchNotificationsFromEvent = createDispatchNotificationsFromEventUseCase({
    notificationRepository,
    userContactLookup,
    jobScheduler,
  });
  subscribeNotificationsEventDispatch(dispatchNotificationsFromEvent);

  const useCases = {
    listNotifications: createListNotificationsUseCase({ notificationRepository }),
    getNotification: createGetNotificationUseCase({ notificationRepository }),
  };

  return createNotificationsRoutes(useCases);
}

/**
 * Called once at worker-process startup (`src/workers/index.ts`) to create
 * the BullMQ Worker that actually sends queued notifications — builds its
 * own dependency graph from scratch rather than sharing state with
 * `createNotificationsModule`'s, same as `indexer/index.ts`'s
 * `createIndexerBackgroundWorker` does relative to its own health-check
 * plugin.
 */
export function createNotificationsBackgroundWorker(prisma: PrismaClient): Worker {
  const notificationRepository = createPrismaNotificationRepository(prisma);
  const userContactLookup = createPrismaUserContactLookup(prisma);
  const config = getConfig();
  const sender = selectNotificationSender(config.NODE_ENV, config.NOTIFICATION_PROVIDER);

  const sendNotification = createSendNotificationUseCase({
    notificationRepository,
    userContactLookup,
    sender,
  });

  return createNotificationsWorker(sendNotification);
}
