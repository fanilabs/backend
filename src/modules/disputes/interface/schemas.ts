import { z } from 'zod';
import { chainId } from '../../../shared/validation/chain-id.js';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';

export { transactionResponseSchema } from '../../../shared/validation/transaction-response.js';

const chainDeliveryId = chainId;
const evidenceHash = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 32-byte hex-encoded hash');
const disputeStatus = z.enum(['OPEN', 'RESOLVED_REFUND', 'RESOLVED_PAYOUT', 'SPLIT']);

const allowedEvidenceContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'video/mp4',
] as const;
const allowedEvidenceContentType = z.enum(allowedEvidenceContentTypes);

/**
 * Upper bound on the base64-encoded evidence payload accepted by the API.
 * 10 MiB of raw bytes expands to ~13.98 MiB when base64-encoded (4/3
 * overhead), so 14 MiB is the largest base64 string that can still decode
 * to a payload within the intended 10 MiB limit. Bounding the string here
 * prevents clients from sending arbitrarily large bodies that would exhaust
 * memory or overflow the evidence storage column before the decoded-size
 * check ever runs.
 */
const MAX_BASE64_CONTENT_LENGTH = 14 * 1024 * 1024;

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
 * new upload-handling stack.
 */
export function createUploadEvidenceBodySchema(maxBytes: number) {
  return z.object({
    uploadedBy: stellarAddress,
    contentType: allowedEvidenceContentType,
    base64Content: z
      .string()
      .min(1)
      .max(MAX_BASE64_CONTENT_LENGTH)
      .refine(
        (base64) => {
          const decodedLength = Math.ceil((base64.length * 3) / 4);
          return decodedLength <= maxBytes;
        },
        {
          message: `File size exceeds maximum of ${maxBytes} bytes`,
        },
      ),
  });
}

export const uploadEvidenceBodySchema = z.object({
  uploadedBy: stellarAddress,
  contentType: allowedEvidenceContentType,
  base64Content: z.string().min(1).max(MAX_BASE64_CONTENT_LENGTH),
});

export const uploadEvidenceResponseSchema = z.object({
  data: z.object({ evidenceId: z.string().uuid(), hash: z.string() }),
});

export const evidenceIdParamsSchema = z.object({ evidenceId: z.string().uuid() });
