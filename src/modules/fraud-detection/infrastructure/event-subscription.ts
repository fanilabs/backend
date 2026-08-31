import { subscribeBlockchainEventHandler } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type { createRecordActorActivityFromEventUseCase } from '../application/index.js';

const log = logger.child({ module: 'fraud-detection-event-subscription' });

/** Wires the module's event handler into the shared in-process bus
 * (src/shared/events). */
export function subscribeFraudDetectionEventDispatch(
  recordActorActivityFromEvent: ReturnType<typeof createRecordActorActivityFromEventUseCase>,
): () => void {
  return subscribeBlockchainEventHandler(
    recordActorActivityFromEvent,
    log,
    'Failed to record actor activity from blockchain event',
  );
}
