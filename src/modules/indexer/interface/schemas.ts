import { z } from 'zod';

const MAX_CONTRACT_NAME_LENGTH = 255;

const contractHealthSchema = z.object({
  contractName: z.string().max(MAX_CONTRACT_NAME_LENGTH),
  configured: z.boolean(),
  lastLedgerSeq: z.string().max(20).nullable(),
  lagLedgers: z.number().nullable(),
  healthy: z.boolean(),
});

export const indexerHealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  latestLedger: z.number(),
  contracts: z.array(contractHealthSchema),
});
