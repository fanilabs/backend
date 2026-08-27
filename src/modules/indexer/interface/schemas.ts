import { z } from 'zod';

const contractHealthSchema = z.object({
  contractName: z.string(),
  configured: z.boolean(),
  lastLedgerSeq: z.string().nullable(),
  lagLedgers: z.number().nullable(),
  healthy: z.boolean(),
});

export const indexerHealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  latestLedger: z.number(),
  contracts: z.array(contractHealthSchema),
});
