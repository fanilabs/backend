import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncFleetFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'fleet-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). */
export function subscribeFleetEventSync(
  syncFleetFromEvent: ReturnType<typeof createSyncFleetFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    syncFleetFromEvent,
    log,
    'Failed to sync fleet from blockchain event',
  );
}
