import { z } from 'zod';
import { chainId } from '../../../shared/validation/chain-id.js';
import { stellarAddress } from '../../../shared/validation/stellar-address.js';

export { transactionResponseSchema } from '../../../shared/validation/transaction-response.js';

const chainDeliveryId = chainId;
export const evidenceHash = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'Must be a 64-character hex SHA-256 digest')
  .transform((val) => val.toLowerCase());
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

export type EvidenceContentType = (typeof allowedEvidenceContentTypes)[number];

/**
 * Magic-byte signatures for each allowed evidence content type. Each entry
 * lists one or more candidate signatures; a file matches the declared type
 * when its header starts with any of them. Signatures are compared against
 * the first 16 bytes of the decoded payload.
 */
const evidenceMagicBytes: Record<EvidenceContentType, readonly (readonly number[])[]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'audio/mpeg': [
    [0x49, 0x44, 0x33], // ID3
    [0xff, 0xfb],
    [0xff, 0xf3],
    [0xff, 0xf2],
  ],
  'video/mp4': [[0x66, 0x74, 0x79, 0x70]], // ftyp (checked at offset 4 below)
};

const MAGIC_BYTE_WINDOW = 16;

function matchesSignature(header: Uint8Array, signature: readonly number[]): boolean {
  if (header.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (header[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Verifies that the decoded file header matches the declared content type.
 * Returns true when the magic bytes are consistent with `contentType`.
 * MP4 stores its `ftyp` box at offset 4, so that signature is checked there.
 */
export function matchesEvidenceMagicBytes(
  bytes: Uint8Array,
  contentType: EvidenceContentType,
): boolean {
  const header = bytes.subarray(0, MAGIC_BYTE_WINDOW);
  if (contentType === 'video/mp4') {
    return matchesSignature(header.subarray(4), [0x66, 0x74, 0x79, 0x70]);
  }
  return evidenceMagicBytes[contentType].some((signature) => matchesSignature(header, signature));
}

/**
 * Upper bound on the base64-encoded evidence payload accepted by the API.
 * 10 MiB of raw bytes expands to ~13.98 MiB when base64-encoded (4/3
 * overhead), so 14 MiB is the largest base64 string that can still decode
 * to a payload within the intended 10 MiB limit. Bounding the string here
 * prevents clients from sending arbitrarily large bodies that would exhaust
 * memory or overflow the evidence storage column before the decoded-size
 * check ever runs.
 */
export const MAX_BASE64_CONTENT_LENGTH = 14 * 1024 * 1024;

/**
 * Transport-level body limit for the evidence upload route. The JSON body
 * wraps the base64 string in an envelope (uploadedBy, contentType, JSON
 * quoting/escaping), so the raw request body is slightly larger than the
 * base64 string itself. This leaves headroom above
 * MAX_BASE64_CONTENT_LENGTH so that a payload within the schema limit is not
 * rejected by Fastify, while anything larger is refused with HTTP 413 before
 * the full JSON body is buffered into memory.
 */
export const EVIDENCE_UPLOAD_BODY_LIMIT = 15 * 1024 * 1024;

const evidenceDto = z.object({
  id: z.string().uuid(),
  hash: evidenceHash,
  contentType: z.string(),
  uploadedBy: z.string().max(255),
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
  resolvedBy: stellarAddress.nullable(),
  resolvedAt: z.string().datetime().nullable(),
  senderShareBps: z.number().int().nullable(),
  evidence: z.array(evidenceDto),
});

export const disputeIdParamsSchema = z.object({
  chainDeliveryId: chainDeliveryId.transform((val, ctx) => {
    try {
      return BigInt(val);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid chain delivery ID',
      });
      return z.NEVER;
    }
  }),
});
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
  data: z.object({ evidenceId: z.string().uuid(), hash: evidenceHash }),
});

export const evidenceIdParamsSchema = z.object({ evidenceId: z.string().uuid() });
