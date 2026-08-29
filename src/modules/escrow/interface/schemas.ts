import { z } from 'zod';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';
const chainDeliveryId = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');
const amount = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');
const escrowStatus = z.enum(['LOCKED', 'RELEASED', 'REFUNDED', 'PAUSED']);

const escrowDto = z.object({
  id: z.string().uuid(),
  chainDeliveryId: z.string(),
  senderAddress: z.string(),
  recipientAddress: z.string(),
  driverAddress: z.string(),
  token: z.string(),
  amount: z.string(),
  platformFee: z.string().nullable(),
  status: escrowStatus,
  disputedBy: z.string().nullable(),
  disputedAt: z.string().datetime().nullable(),
  releasedAt: z.string().datetime().nullable(),
  refundedAt: z.string().datetime().nullable(),
  createdAtChain: z.string().datetime(),
});

export const escrowIdParamsSchema = z.object({ chainDeliveryId });
export const getEscrowResponseSchema = z.object({ data: escrowDto });

export const transactionResponseSchema = z.object({ data: z.object({ xdr: z.string() }) });

export const createEscrowBodySchema = z.object({
  senderAddress: stellarAddress,
  recipientAddress: stellarAddress,
  driverAddress: stellarAddress,
  chainDeliveryId,
  token: stellarAddress,
  amount,
});

export const releaseEscrowBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
});

export const refundEscrowBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
});
