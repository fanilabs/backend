import { z } from 'zod';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';
const chainFleetId = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');
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
export const getFleetResponseSchema = z.object({ data: fleetDto });

export const payoutAddressParamsSchema = z.object({ chainFleetId, driverAddress: stellarAddress });
export const payoutAddressResponseSchema = z.object({
  data: z.object({ payoutAddress: z.string() }),
});

export const transactionResponseSchema = z.object({ data: z.object({ xdr: z.string() }) });

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
