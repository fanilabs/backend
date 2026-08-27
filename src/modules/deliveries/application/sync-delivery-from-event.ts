import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
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
    if (event.contractName !== 'delivery') {
      return;
    }

    const topic = event.topic[0];
    const payload = Array.isArray(event.payload) ? event.payload : [];

    switch (topic) {
      case 'delivery_created': {
        const chainDeliveryId = parseDeliveryId(payload[0]);
        if (chainDeliveryId === null) return;
        const record = await deps.contractReader.getDelivery(chainDeliveryId);
        await deps.deliveryRepository.create(record);
        return;
      }

      case 'driver_assigned': {
        const chainDeliveryId = parseDeliveryId(payload[0]);
        const driverAddress = parseAddress(payload[1]);
        if (chainDeliveryId === null || driverAddress === null) return;
        await deps.deliveryRepository.updateStatus(chainDeliveryId, {
          status: 'ACTIVE',
          driverAddress,
        });
        return;
      }

      case 'DeliveryInTransit': {
        const chainDeliveryId = parseDeliveryId(payload[0]);
        if (chainDeliveryId === null) return;
        await deps.deliveryRepository.updateStatus(chainDeliveryId, {
          status: 'IN_TRANSIT',
          transitStartedAt: event.closedAt,
        });
        return;
      }

      case 'delivery_confirmed': {
        const chainDeliveryId = parseDeliveryId(payload[0]);
        if (chainDeliveryId === null) return;
        // The on-chain event carries no timestamp of its own — the
        // indexer's ledger-close time is the best available on-chain
        // timing signal (accurate to within one ledger's close interval).
        await deps.deliveryRepository.updateStatus(chainDeliveryId, {
          status: 'DELIVERED',
          deliveredAt: event.closedAt,
        });
        return;
      }

      case 'delivery_cancelled': {
        const chainDeliveryId = parseDeliveryId(payload[0]);
        if (chainDeliveryId === null) return;
        await deps.deliveryRepository.updateStatus(chainDeliveryId, { status: 'CANCELLED' });
        return;
      }

      case 'delivery_disputed': {
        const chainDeliveryId = parseDeliveryId(payload[0]);
        if (chainDeliveryId === null) return;
        await deps.deliveryRepository.updateStatus(chainDeliveryId, { status: 'DISPUTED' });
        return;
      }

      default:
        // Other delivery_contract events (none currently) or a future
        // addition this handler doesn't know about yet — ignored, not an
        // error (docs/EVENT_INDEXER.md's malformed/unknown-event handling).
        return;
    }
  };
}

function parseDeliveryId(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseAddress(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
