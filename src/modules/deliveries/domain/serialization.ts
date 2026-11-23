import '../../../shared/serialization/bigint.js';
import type { Delivery } from './entities.js';

/**
 * Wire format for a serialized Delivery.
 *
 * Client consumption notes:
 * - `id` and `chainDeliveryId` are decimal strings. Large identifiers may
 *   exceed `Number.MAX_SAFE_INTEGER` (e.g. `"9007199254740993"`), so clients
 *   MUST keep them as strings and never coerce them to `Number`.
 * - `createdAtChain`, `transitStartedAt`, and `deliveredAt` are ISO-8601 UTC
 *   strings (e.g. `"2024-01-15T12:34:56.000Z"`). These are HTTP wire dates,
 *   distinct from internal ledger timestamps, which are Unix seconds.
 * - Lifecycle timestamps that have not occurred yet are serialized as explicit
 *   `null` (not epoch zero / `"1970-01-01T00:00:00.000Z"`).
 */
export interface SerializedDelivery {
  id: string;
  chainDeliveryId: string;
  senderAddress: string;
  recipientAddress: string;
  driverAddress: string | null;
  status: Delivery['status'];
  origin: string;
  destination: string;
  cargoCategory: Delivery['cargoCategory'];
  weightGrams: number;
  fragile: boolean;
  createdAtChain: string;
  transitStartedAt: string | null;
  deliveredAt: string | null;
}

/**
 * Standard serializer for Delivery domain entities. Normalizes bigint
 * fields (`chainDeliveryId`) to strings and dates to ISO strings for API responses.
 */
export function serializeDelivery(delivery: Delivery): SerializedDelivery {
  return {
    id: delivery.id,
    chainDeliveryId: delivery.chainDeliveryId.toString(),
    senderAddress: delivery.senderAddress,
    recipientAddress: delivery.recipientAddress,
    driverAddress: delivery.driverAddress,
    status: delivery.status,
    origin: delivery.origin,
    destination: delivery.destination,
    cargoCategory: delivery.cargoCategory,
    weightGrams: delivery.weightGrams,
    fragile: delivery.fragile,
    createdAtChain: delivery.createdAtChain.toISOString(),
    transitStartedAt: delivery.transitStartedAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}
