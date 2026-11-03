import { ValidationError } from '../../../shared/errors/app-error.js';

/** escrow_contract uses a bare u64 delivery key, not a database/user UUID
 * or delivery_contract's tuple-wrapped DeliveryId. */
export const ESCROW_DELIVERY_ID_MAX = (1n << 64n) - 1n;

export function assertEscrowDeliveryId(value: unknown): asserts value is bigint {
  if (typeof value !== 'bigint' || value < 0n || value > ESCROW_DELIVERY_ID_MAX) {
    throw new ValidationError('chainDeliveryId must be an unsigned 64-bit integer');
  }
}
