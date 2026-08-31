import { z } from 'zod';
import { chainId } from '../../../shared/validation/chain-id.js';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';

export { transactionResponseSchema } from '../../../shared/validation/transaction-response.js';

const chainFleetId = chainId;
const fleetDriverStatus = z.enum(['PENDING', 'ACTIVE']);

const fleetDriverDto = z.object({
  id: z.string().uuid(),
  driverAddress: z.string(),
  status: fleetDriverStatus,
  invitedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  removedAt: z.string().datetime().nullable(),
});

const fleetDto = z.object({
  id: z.string().uuid(),
  chainFleetId: z.string(),
  ownerAddress: z.string(),
  treasuryAddress: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  drivers: z.array(fleetDriverDto),
  totalActiveDrivers: z.number().int(),
});

export const fleetIdParamsSchema = z.object({ chainFleetId });

/**
 * `includeRemoved` defaults to `false` so `GET /fleets/:chainFleetId`
 * returns current members only — the `removedAt === null` filter
 * `FleetDriver`'s own doc comment says every caller must otherwise
 * reimplement. `z.coerce.boolean()` isn't used here: it treats *any*
 * non-empty query string (including the literal `"false"`) as `true`, which
 * would make `?includeRemoved=false` a no-op — this explicit `enum` +
 * `transform` avoids that trap.
 */
export const getFleetQuerySchema = z.object({
  includeRemoved: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  driverLimit: z.coerce.number().int().positive().max(500).optional().default(100),
});
export const getFleetResponseSchema = z.object({ data: fleetDto });

export const payoutAddressParamsSchema = z.object({ chainFleetId, driverAddress: stellarAddress });
export const payoutAddressResponseSchema = z.object({
  data: z.object({ payoutAddress: z.string() }),
});

export const registerFleetBodySchema = z.object({
  ownerAddress: stellarAddress,
  treasuryAddress: stellarAddress,
});

export const updateFleetTreasuryBodySchema = z.object({
  ownerAddress: stellarAddress,
  chainFleetId,
  treasuryAddress: stellarAddress,
});

export const addDriverToFleetBodySchema = z.object({
  callerAddress: stellarAddress,
  chainFleetId,
  driverAddress: stellarAddress,
});

export const acceptFleetInviteBodySchema = z.object({
  chainFleetId,
  driverAddress: stellarAddress,
});

export const removeDriverFromFleetBodySchema = z.object({
  callerAddress: stellarAddress,
  chainFleetId,
  driverAddress: stellarAddress,
});
