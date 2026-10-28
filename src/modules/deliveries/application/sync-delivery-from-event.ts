import { deliveryMutation } from './delivery-mutation.js';
import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseBigIntId } from '../../../shared/events/index.js';
import { ContractName } from '../../../shared/events/contract-names.js';
import type { DeliveryContractReader, DeliveryRepository } from '../domain/index.js';

export interface SyncDeliveryFromEventDeps {
  deliveryRepository: DeliveryRepository;
  contractReader: DeliveryContractReader;
}

/**
 * Reacts to `delivery_contract` events published by the indexer
 * (src/shared/events) and updates the local read model — the only writer
 * of `deliveries` (docs/EVENT_INDEXER.md). Ignores events from any other
 * contract (the bus carries every tracked contract's events on one channel).
 *
 * `delivery_created`'s on-chain payload is only `(delivery_id, sender)` —
 * no origin/destination/cargo metadata (PHASE_1_DOMAIN_ANALYSIS.md §4) — so
 * that one case makes a supplementary `get_delivery` read call to hydrate
 * the full record. Every other event carries enough in its own payload to
 * update the record directly.
 */
export function createSyncDeliveryFromEventUseCase(deps: SyncDeliveryFromEventDeps) {
  return async function syncDeliveryFromEvent(event: BlockchainEventEnvelope): Promise<void> {
    if (event.contractName !== ContractName.Delivery) {
      return;
    }

    const topic = event.topic[0];
    const payload = Array.isArray(event.payload) ? event.payload : [];

    if (topic === 'delivery_created') {
      const chainDeliveryId = parseBigIntId(payload[0]);
      if (chainDeliveryId === null) return;
      const record = await deps.contractReader.getDelivery(chainDeliveryId);
      await deps.deliveryRepository.create(record);
      return;
    }
    const mutation = deliveryMutation(event);
    if (mutation)
      await deps.deliveryRepository.updateStatus(mutation.chainDeliveryId, mutation.patch);
  };
}
