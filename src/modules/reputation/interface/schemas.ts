import { z } from 'zod';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';

export { transactionResponseSchema } from '../../../shared/validation/transaction-response.js';

const driverTier = z.enum(['BRONZE', 'SILVER', 'GOLD']);

const driverProfileDto = z.object({
  id: z.string().uuid(),
  address: z.string(),
  reputationScore: z.number().int(),
  tier: driverTier.describe(
    'Driver tier derived from the reputation score (BRONZE, SILVER or GOLD).',
  ),
  kycVerified: z
    .boolean()
    .describe('Whether the driver has passed KYC verification.'),
  deliveriesCompleted: z
    .number()
    .int()
    .describe(
      'Canonical completed-delivery count. This is the identity-reputation source of truth and should be used for product decisions.',
    ),
  legacyDeliveriesCompleted: z
    .number()
    .int()
    .describe(
      'Completed-delivery count read from the separate legacy source. It can differ from deliveriesCompleted; see docs/DATABASE.md for the rationale. Do not use it for product decisions.',
    ),
  registeredAt: z
    .string()
    .datetime()
    .describe('ISO-8601 timestamp of when the driver profile was registered.'),
});

export const driverAddressParamsSchema = z.object({ address: stellarAddress });
export const getDriverProfileResponseSchema = z.object({ data: driverProfileDto });

export const registerDriverBodySchema = z.object({
  driverAddress: stellarAddress,
});

export const updateDriverKycStatusBodySchema = z.object({
  adminAddress: stellarAddress,
  driverAddress: stellarAddress,
  kycVerified: z.boolean(),
});
