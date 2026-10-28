import type { PrismaClient } from '@prisma/client';
import { createRecordActorActivityFromEventUseCase } from './application/record-actor-activity-from-event.js';
import { createPrismaActorActivityRepository } from './infrastructure/prisma-actor-activity-repository.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createFraudActivityEventConsumer(prisma: PrismaClient) {
  return createRecordActorActivityFromEventUseCase({
    activityRepository: createPrismaActorActivityRepository(prisma),
  });
}
