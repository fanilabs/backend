import type { PrismaClient } from '@prisma/client';
import { createConsumerRegistry } from '../modules/indexer/index.js';
import { createDeliveryEventConsumer } from '../modules/deliveries/event-consumer.js';
import { createEscrowEventConsumer } from '../modules/escrow/event-consumer.js';
import { createDisputeEventConsumer } from '../modules/disputes/event-consumer.js';
import { createReputationEventConsumer } from '../modules/reputation/event-consumer.js';
import { createFleetEventConsumer } from '../modules/fleet/event-consumer.js';
import { createFraudActivityEventConsumer } from '../modules/fraud-detection/event-consumer.js';
import { createNotificationIntentEventConsumer } from '../modules/notifications/event-consumer.js';

/** Same composition is used by the actual production worker entry point.
 * Constructs real adapters, never calls handlers or attaches them to the old bus.
 */
export function createWorkerEventConsumers(prisma: PrismaClient) {
  const databasePrerequisites = [
    'atomic_effect_and_completion',
    'aggregate_ordering',
    'partial_effect_recovery',
  ];
  const registry = createConsumerRegistry([
    {
      id: 'deliveries',
      handler: createDeliveryEventConsumer(prisma),
      blockedBy: databasePrerequisites,
    },
    { id: 'escrow', handler: createEscrowEventConsumer(prisma), blockedBy: databasePrerequisites },
    {
      id: 'disputes',
      handler: createDisputeEventConsumer(prisma),
      blockedBy: databasePrerequisites,
    },
    {
      id: 'reputation',
      handler: createReputationEventConsumer(prisma),
      blockedBy: databasePrerequisites,
    },
    { id: 'fleet', handler: createFleetEventConsumer(prisma), blockedBy: databasePrerequisites },
    {
      id: 'fraud-activity',
      handler: createFraudActivityEventConsumer(prisma),
      blockedBy: [...databasePrerequisites, 'M34_source_event_uniqueness'],
    },
    {
      id: 'notification-intent',
      handler: createNotificationIntentEventConsumer(prisma),
      blockedBy: ['transactional_outbox', 'recipient_deduplication', 'partial_effect_recovery'],
    },
  ]);
  registry.assertRequiredRegistrations();
  return registry;
}
