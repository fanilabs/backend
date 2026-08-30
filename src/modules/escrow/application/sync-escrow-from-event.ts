import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseAddress, parseBigIntId } from '../../../shared/events/index.js';
import type { EscrowContractReader, EscrowRepository } from '../domain/index.js';

export interface SyncEscrowFromEventDeps {
  escrowRepository: EscrowRepository;
  contractReader: EscrowContractReader;
}

/**
 * Reacts to `escrow_contract` events. **Unlike `delivery_contract`,
 * `escrow_contract` puts the delivery id in the event *topic*
 * (`(Symbol, delivery_id)`, verified directly against
 * `contracts/escrow_contract/lib.rs`), not the data payload** — every
 * `publish()` call in that file uses this two-segment topic form. Getting
 * this backwards (reading `payload[0]` like the `deliveries` module does)
 * would silently misattribute every event to the wrong delivery, so this
 * is called out explicitly rather than left as an easy-to-miss detail.
 *
 * `escrow_funded`'s payload carries neither `driver` nor `token`, and
 * `dispute_resolved` fires identically regardless of whether the admin
 * released or refunded — both cases fall back to a `get_escrow` read call
 * (PHASE_1_DOMAIN_ANALYSIS.md §3 / domain/ports.ts).
 */
export function createSyncEscrowFromEventUseCase(deps: SyncEscrowFromEventDeps) {
  return async function syncEscrowFromEvent(event: BlockchainEventEnvelope): Promise<void> {
    if (event.contractName !== 'escrow') {
      return;
    }

    const eventName = event.topic[0];
    const chainDeliveryId = parseBigIntId(event.topic[1]);
    if (chainDeliveryId === null) return;

    const payload = Array.isArray(event.payload) ? event.payload : [];

    switch (eventName) {
      case 'escrow_funded': {
        const record = await deps.contractReader.getEscrow(chainDeliveryId);
        await deps.escrowRepository.create(record);
        return;
      }

      case 'escrow_released': {
        const platformFee = parseAmount(payload[2]);
        await deps.escrowRepository.updateStatus(chainDeliveryId, {
          status: 'RELEASED',
          releasedAt: event.closedAt,
          ...(platformFee !== null && { platformFee }),
        });
        return;
      }

      case 'escrow_refunded': {
        await deps.escrowRepository.updateStatus(chainDeliveryId, {
          status: 'REFUNDED',
          refundedAt: event.closedAt,
        });
        return;
      }

      case 'delivery_disputed': {
        const disputedBy = parseAddress(payload[0]);
        await deps.escrowRepository.updateStatus(chainDeliveryId, {
          status: 'PAUSED',
          disputedAt: event.closedAt,
          ...(disputedBy !== null && { disputedBy }),
        });
        return;
      }

      case 'dispute_resolved': {
        // The event alone can't tell release from refund — both branches
        // of resolve_dispute/resolve_dispute_split emit this exact same
        // event, so the only way to know the outcome is to ask the chain.
        const record = await deps.contractReader.getEscrow(chainDeliveryId);
        if (record.status === 'RELEASED') {
          await deps.escrowRepository.updateStatus(chainDeliveryId, {
            status: 'RELEASED',
            releasedAt: event.closedAt,
          });
        } else if (record.status === 'REFUNDED') {
          await deps.escrowRepository.updateStatus(chainDeliveryId, {
            status: 'REFUNDED',
            refundedAt: event.closedAt,
          });
        }
        return;
      }

      default:
        // FeeUpdated/AdminTransferred/ProtocolInitialized are protocol-
        // config events, not per-escrow state — no read-model row to update.
        return;
    }
  };
}

function parseAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
