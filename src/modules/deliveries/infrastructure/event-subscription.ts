import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncDeliveryFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'deliveries-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). */
export function subscribeDeliveryEventSync(
  syncDeliveryFromEvent: ReturnType<typeof createSyncDeliveryFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    syncDeliveryFromEvent,
    log,
    'Failed to sync delivery from blockchain event',
  );
}
