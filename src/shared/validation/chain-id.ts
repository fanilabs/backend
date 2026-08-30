import { z } from 'zod';

/**
 * An on-chain numeric identifier as it arrives over HTTP: always a string,
 * always a bare non-negative integer (no sign, leading `+`, decimal point or
 * whitespace).
 *
 * Named generically because the identical shape backs `chainDeliveryId`
 * (deliveries, disputes, escrow) and `chainFleetId` (fleet) — it was
 * previously redefined character-for-character in each of those modules'
 * `interface/schemas.ts`.
 */
export const chainId = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');
