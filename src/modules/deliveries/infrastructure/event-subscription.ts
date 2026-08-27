import { onBlockchainEvent } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncDeliveryFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'deliveries-event-subscription' });

/**
 * Wires the module's event handler into the shared in-process bus
 * (src/shared/events). `onBlockchainEvent`'s callback is synchronous, so
 * the async use case's rejection is caught and logged here rather than
 * becoming an unhandled promise rejection — one malformed/unexpected event
 * must not crash the process or block subsequent events
 * (docs/EVENT_INDEXER.md's malformed-event handling).
 */
export function subscribeDeliveryEventSync(
  syncDeliveryFromEvent: ReturnType<typeof createSyncDeliveryFromEventUseCase>,
): () => void {
  return onBlockchainEvent((event) => {
    syncDeliveryFromEvent(event).catch((error: unknown) => {
      log.error({ err: error, event }, 'Failed to sync delivery from blockchain event');
    });
  });
}
