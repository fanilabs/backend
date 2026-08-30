import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createDispatchNotificationsFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'notifications-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). */
export function subscribeNotificationsEventDispatch(
  dispatchNotificationsFromEvent: ReturnType<typeof createDispatchNotificationsFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    dispatchNotificationsFromEvent,
    log,
    'Failed to dispatch notifications from blockchain event',
  );
}
