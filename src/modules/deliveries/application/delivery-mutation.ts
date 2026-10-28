import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseAddress, parseBigIntId } from '../../../shared/events/index.js';
import type { DeliveryStatusPatch } from '../domain/ports.js';

/** Existing delivery patch semantics; null preserves legacy malformed-event
 * handling. Durable processing must reject null rather than acknowledge it.
 */
export function deliveryMutation(
  event: BlockchainEventEnvelope,
): { chainDeliveryId: bigint; patch: DeliveryStatusPatch } | null {
  if (event.contractName !== 'delivery') return null;
  const payload = Array.isArray(event.payload) ? event.payload : [];
  const chainDeliveryId = parseBigIntId(payload[0]);
  if (chainDeliveryId === null) return null;
  switch (event.topic[0]) {
    case 'driver_assigned': {
      const driverAddress = parseAddress(payload[1]);
      return driverAddress === null
        ? null
        : { chainDeliveryId, patch: { status: 'ACTIVE', driverAddress } };
    }
    case 'DeliveryInTransit':
      return { chainDeliveryId, patch: { status: 'IN_TRANSIT', transitStartedAt: event.closedAt } };
    case 'delivery_confirmed':
      return { chainDeliveryId, patch: { status: 'DELIVERED', deliveredAt: event.closedAt } };
    case 'delivery_cancelled':
      return { chainDeliveryId, patch: { status: 'CANCELLED' } };
    case 'delivery_disputed':
      return { chainDeliveryId, patch: { status: 'DISPUTED' } };
    default:
      return null;
  }
}
