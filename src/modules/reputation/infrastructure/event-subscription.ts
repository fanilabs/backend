import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncReputationFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'reputation-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). */
export function subscribeReputationEventSync(
  syncReputationFromEvent: ReturnType<typeof createSyncReputationFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    syncReputationFromEvent,
    log,
    'Failed to sync reputation from blockchain event',
  );
}
