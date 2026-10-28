import type { PrismaClient } from '@prisma/client';
import { createDispatchNotificationsFromEventUseCase } from './application/dispatch-notifications-from-event.js';
import { createPrismaNotificationRepository } from './infrastructure/prisma-notification-repository.js';
import { createPrismaUserContactLookup } from './infrastructure/prisma-user-contact-lookup.js';
import { createPrismaDeliveryPartyLookup } from './infrastructure/prisma-delivery-party-lookup.js';
import { createNotificationJobScheduler } from './infrastructure/queue.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createNotificationIntentEventConsumer(prisma: PrismaClient) {
  return createDispatchNotificationsFromEventUseCase({
    notificationRepository: createPrismaNotificationRepository(prisma),
    userContactLookup: createPrismaUserContactLookup(prisma),
    deliveryPartyLookup: createPrismaDeliveryPartyLookup(prisma),
    jobScheduler: createNotificationJobScheduler(),
  });
}
