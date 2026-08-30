import { z } from 'zod';
import { chainId } from '../../../shared/validation/chain-id.js';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';

export { transactionResponseSchema } from '../../../shared/validation/transaction-response.js';

const chainDeliveryId = chainId;
const cargoCategory = z.enum(['DOCUMENTS', 'ELECTRONICS', 'PERISHABLES', 'CLOTHING', 'GENERAL']);
const deliveryStatus = z.enum([
  'PENDING',
  'ACTIVE',
  'IN_TRANSIT',
  'DELIVERED',
  'DISPUTED',
  'CANCELLED',
]);

const deliveryDto = z.object({
  id: z.string().uuid(),
  chainDeliveryId: z.string(),
  senderAddress: z.string(),
  recipientAddress: z.string(),
  driverAddress: z.string().nullable(),
  status: deliveryStatus,
  origin: z.string(),
  destination: z.string(),
  cargoCategory,
  weightGrams: z.number().int(),
  fragile: z.boolean(),
  createdAtChain: z.string().datetime(),
  transitStartedAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
});

export const listDeliveriesQuerySchema = z.object({
  senderAddress: stellarAddress.optional(),
  recipientAddress: stellarAddress.optional(),
  driverAddress: stellarAddress.optional(),
  status: deliveryStatus.optional(),
});
export const listDeliveriesResponseSchema = z.object({ data: z.array(deliveryDto) });

export const deliveryIdParamsSchema = z.object({ chainDeliveryId });
export const getDeliveryResponseSchema = z.object({ data: deliveryDto });

export const createDeliveryBodySchema = z.object({
  senderAddress: stellarAddress,
  recipientAddress: stellarAddress,
  origin: z.string().min(1).max(256),
  destination: z.string().min(1).max(256),
  cargoCategory,
  weightGrams: z.number().int().positive(),
  fragile: z.boolean(),
  estimatedDelivery: z.string().datetime(),
});

export const assignDriverBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
  driverAddress: stellarAddress,
});

export const markInTransitBodySchema = z.object({
  driverAddress: stellarAddress,
  chainDeliveryId,
});

export const confirmDeliveryBodySchema = z.object({
  recipientAddress: stellarAddress,
  chainDeliveryId,
});

export const cancelDeliveryBodySchema = z.object({
  senderAddress: stellarAddress,
  chainDeliveryId,
});
