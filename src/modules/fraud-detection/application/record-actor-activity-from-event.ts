import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseAddress } from '../../../shared/events/index.js';
import type { ActorActivityRepository, RecordActivityInput } from '../domain/index.js';

export interface RecordActorActivityFromEventDeps {
  activityRepository: ActorActivityRepository;
}

/**
 * Reacts to the same in-process event bus every other module subscribes
 * to. Deliberately narrow, same reasoning as `notifications`' own
 * dispatch handler (see its header comment): only three event/address
 * pairs are both directly available *and* map cleanly onto
 * `ARCHITECTURE.md` §4's "delivery/escrow/dispute velocity per actor" —
 *
 *  - `delivery.delivery_created` — payload is `(delivery_id, sender)`,
 *    verified against `deliveries`' own `domain/ports.ts` — sender
 *    velocity as a proxy for spam/wash-trading delivery creation.
 *  - `escrow.escrow_released` — payload is `(driver, payout, fee)`,
 *    verified against `EVENT_INDEXER.md`'s escrow section — driver
 *    payout velocity as a proxy for self-dealing/impossibly-fast
 *    deliveries.
 *  - `escrow.delivery_disputed` — payload is `(disputed_by)` — dispute-
 *    raise velocity as a proxy for dispute-mechanism abuse.
 *
 * No rule evaluation happens here — this only durably logs the raw
 * activity; `assessActor` evaluates rules against it at read time (same
 * "recompute from source of truth, don't accumulate derived state"
 * posture `reputation` already applies elsewhere in this backend).
 */
export function createRecordActorActivityFromEventUseCase(deps: RecordActorActivityFromEventDeps) {
  return async function recordActorActivityFromEvent(
    event: BlockchainEventEnvelope,
  ): Promise<void> {
    const activity = resolveActivity(event);
    if (!activity) return;
    await deps.activityRepository.record(activity);
  };
}

function resolveActivity(event: BlockchainEventEnvelope): RecordActivityInput | null {
  const payload = Array.isArray(event.payload) ? event.payload : [];

  switch (event.contractName) {
    case 'delivery': {
      if (event.topic[0] !== 'delivery_created') return null;
      const senderAddress = parseAddress(payload[1]);
      if (senderAddress === null) return null;
      return { address: senderAddress, category: 'DELIVERY_CREATED', occurredAt: event.closedAt };
    }

    case 'escrow': {
      if (event.topic[0] === 'escrow_released') {
        const driverAddress = parseAddress(payload[0]);
        if (driverAddress === null) return null;
        return {
          address: driverAddress,
          category: 'ESCROW_RELEASED',
          occurredAt: event.closedAt,
        };
      }

      if (event.topic[0] === 'delivery_disputed') {
        const disputedBy = parseAddress(payload[0]);
        if (disputedBy === null) return null;
        return { address: disputedBy, category: 'DISPUTE_RAISED', occurredAt: event.closedAt };
      }

      return null;
    }

    default:
      return null;
  }
}
