import { z } from 'zod';

export const gmvResponseSchema = z.object({
  data: z.array(
    z.object({
      token: z.string(),
      releasedAmount: z.string(),
      releasedCount: z.number().int(),
    }),
  ),
});

export const completionRateResponseSchema = z.object({
  data: z.object({
    totalDeliveries: z.number().int(),
    deliveredCount: z.number().int(),
    completionRate: z.number(),
  }),
});

export const disputeRateResponseSchema = z.object({
  data: z.object({
    totalDeliveries: z.number().int(),
    disputedCount: z.number().int(),
    disputeRate: z.number(),
  }),
});

export const driverTierDistributionResponseSchema = z.object({
  data: z.object({
    bronze: z.number().int(),
    silver: z.number().int(),
    gold: z.number().int(),
    total: z.number().int(),
  }),
});
