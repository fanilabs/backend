import { publishBlockchainEvent } from '../../../shared/events/index.js';
import type { EventPublisher } from '../domain/index.js';

export function createInProcessEventBus(): EventPublisher {
  return {
    publish(event) {
      publishBlockchainEvent(event);
    },
  };
}
