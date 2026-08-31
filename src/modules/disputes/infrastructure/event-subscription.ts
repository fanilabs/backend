import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createSyncDisputeFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'dispute-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). Unlike the other modules, this one's use case itself
 * filters on *two* contract names (`dispute-resolution` and `escrow`) rather
 * than one — see sync-dispute-from-event.ts's header comment.
 */
export function subscribeDisputeEventSync(
  syncDisputeFromEvent: ReturnType<typeof createSyncDisputeFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    syncDisputeFromEvent,
    log,
    'Failed to sync dispute from blockchain event',
  );
}
