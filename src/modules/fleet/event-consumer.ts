import type { PrismaClient } from '@prisma/client';
import { createSyncFleetFromEventUseCase } from './application/sync-fleet-from-event.js';
import { createPrismaFleetRepository } from './infrastructure/prisma-fleet-repository.js';

/** Worker-only construction entry: no HTTP routes or legacy bus subscription.
 * This returns the real handler; the worker registry keeps it inaccessible
 * while transactional completion/idempotency/recovery are unverified.
 */
export function createFleetEventConsumer(prisma: PrismaClient) {
  return createSyncFleetFromEventUseCase({ fleetRepository: createPrismaFleetRepository(prisma) });
}
