import { z } from 'zod';

/**
 * Standard response envelope for every endpoint that returns an unsigned
 * Soroban transaction for the client to sign: `{ data: { xdr } }`.
 *
 * Previously redefined verbatim in the deliveries, disputes, escrow, fleet
 * and reputation modules' `interface/schemas.ts`; defined once here so a
 * future change to the envelope applies everywhere at once.
 *
 * A successful build response contains only the unsigned envelope fields
 * (`data.xdr`). It does not create a pending transaction record, return a
 * receipt ID, or confirm chain state. Signing, submission and on-chain
 * observation happen outside this backend surface.
 */
export const transactionResponseSchema = z.object({ data: z.object({ xdr: z.string() }) });
