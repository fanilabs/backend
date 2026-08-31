import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncEscrowFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'escrow-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). */
export function subscribeEscrowEventSync(
  syncEscrowFromEvent: ReturnType<typeof createSyncEscrowFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    syncEscrowFromEvent,
    log,
    'Failed to sync escrow from blockchain event',
  );
}
