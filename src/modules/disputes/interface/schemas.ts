import { z } from 'zod';

/** Stellar (Soroban) public key: 'G' + 55 base32 characters. */
const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, 'Not a valid Stellar public key');
const chainDeliveryId = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');
const evidenceHash = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 32-byte hex-encoded hash');
const disputeStatus = z.enum(['OPEN', 'RESOLVED_REFUND', 'RESOLVED_PAYOUT', 'SPLIT']);

const evidenceDto = z.object({
  id: z.string().uuid(),
  hash: z.string(),
  contentType: z.string(),
  uploadedBy: z.string(),
  createdAt: z.string().datetime(),
  confirmedOnChain: z.boolean(),
});

const disputeDto = z.object({
  id: z.string().uuid(),
  chainDeliveryId: z.string(),
  status: disputeStatus,
  // Tightened to the same Stellar-address shape every request schema
  // already enforces — raisedBy is used as an authorisation subject
  // (downloadEvidence's raiser check), so a malformed value stored by a
  // future bug should fail loudly here at the API boundary rather than
  // being served as if it were a real address.
  raisedBy: stellarAddress,
  raisedAt: z.string().datetime(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  senderShareBps: z.number().int().nullable(),
  evidence: z.array(evidenceDto),
});

export const disputeIdParamsSchema = z.object({ chainDeliveryId });
export const getDisputeResponseSchema = z.object({ data: disputeDto });

export const transactionResponseSchema = z.object({ data: z.object({ xdr: z.string() }) });

export const raiseDisputeBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
});

export const addEvidenceHashBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
  evidenceHash,
});

export const resolveDisputeBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
});

export const resolveDisputeSplitFundsBodySchema = z.object({
  callerAddress: stellarAddress,
  chainDeliveryId,
  senderShareBps: z.number().int().min(0).max(10_000),
});

/**
 * Evidence bytes travel as base64 in a plain JSON body (consistent with the
 * rest of this API — no other module uses multipart) rather than a
 * multipart upload, which keeps this v1 slice's scope to what's already a
 * dependency (Zod + this API's existing JSON envelope) instead of adding a
 * new upload-handling stack. That means it's bounded by Fastify's default
 * 1MB request body limit — fine for photos/documents/short recordings, not
 * for large video evidence. A documented v1 limitation (ROADMAP.md §9 is
 * the place to track it if it needs lifting), not a silent one.
 */
export const uploadEvidenceBodySchema = z.object({
  uploadedBy: stellarAddress,
  contentType: z.string().min(1).max(255),
  base64Content: z.string().min(1),
});

export const uploadEvidenceResponseSchema = z.object({
  data: z.object({ evidenceId: z.string().uuid(), hash: z.string() }),
});

export const evidenceIdParamsSchema = z.object({ evidenceId: z.string().uuid() });
