import { z } from 'zod';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';

export const actorAddressParamsSchema = z.object({ address: stellarAddress });

const fraudRuleType = z.enum([
  'DELIVERY_CREATION_VELOCITY',
  'ESCROW_RELEASE_VELOCITY',
  'DISPUTE_RAISE_VELOCITY',
]);
const actorActivityCategory = z.enum(['DELIVERY_CREATED', 'ESCROW_RELEASED', 'DISPUTE_RAISED']);

export const assessActorResponseSchema = z.object({
  data: z.object({
    address: z.string(),
    flagged: z.boolean(),
    signals: z.array(
      z.object({
        ruleType: fraudRuleType,
        category: actorActivityCategory,
        windowHours: z.number().int(),
        threshold: z.number().int(),
        count: z.number().int(),
        triggered: z.boolean(),
      }),
    ),
  }),
});
