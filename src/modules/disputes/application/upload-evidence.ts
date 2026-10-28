import { createHash } from 'node:crypto';
import type {
  DisputeRepository,
  Evidence,
  EvidenceRepository,
  EvidenceStorage,
  WalletOwnershipRepository,
} from '../domain/index.js';
import {
  DisputeNotFoundError,
  DisputeNotOpenError,
  ForbiddenEvidenceUploadError,
} from '../domain/index.js';
import { ValidationError } from '../../../shared/errors/app-error.js';

export interface UploadEvidenceDeps {
  disputeRepository: DisputeRepository;
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
  walletOwnershipRepository: WalletOwnershipRepository;
}

export interface UploadEvidenceInput {
  chainDeliveryId: bigint;
  contentType: string;
  uploadedBy: string;
  bytes: Buffer;
  /** The authenticated caller's own account id — must own `uploadedBy` via
   * a linked wallet (Phase 6 security review finding: previously anyone
   * could upload evidence to any open dispute under any address's name). */
  requesterId: string;
}

export interface UploadEvidenceResult {
  evidence: Evidence;
}

/**
 * Magic byte signatures for the evidence content types this module accepts.
 * Each entry is a list of acceptable byte prefixes for that declared MIME
 * type — a file must match at least one of them. Used to reject files whose
 * actual content doesn't match the client-declared `contentType` (issue #394:
 * relying on the declared MIME type alone enables file format spoofing).
 */
const MAGIC_BYTES: Record<string, readonly (readonly number[])[]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'audio/mpeg': [
    [0x49, 0x44, 0x33], // ID3
    [0xff, 0xfb],
  ],
  'video/mp4': [[0x66, 0x74, 0x79, 0x70]], // ftyp
};

/**
 * Verifies the first 16 bytes of `bytes` against the known magic byte
 * signatures for `contentType`. Throws `ValidationError` when the content
 * does not match the declared type. Content types without a registered
 * signature are left to the schema-level allowlist check.
 */
function assertMagicBytesMatch(contentType: string, bytes: Buffer): void {
  const signatures = MAGIC_BYTES[contentType];
  if (!signatures) {
    return;
  }

  const header = bytes.subarray(0, 16);
  const matches = signatures.some(
    (signature) =>
      header.length >= signature.length && signature.every((byte, index) => header[index] === byte),
  );

  if (!matches) {
    throw new ValidationError('File content does not match declared contentType');
  }
}

/**
 * Stores an evidence file and computes its content hash — the hash this
 * returns is exactly what the client must then pass to
 * `buildAddEvidenceHashTransaction` so the on-chain `BytesN<32>` matches
 * what's stored here (PHASE_1_DOMAIN_ANALYSIS.md §5). This backend never
 * calls `add_evidence_hash` itself; only a sender/recipient wallet
 * signature can, per that function's on-chain `require_auth`.
 *
 * Mirrors `add_evidence_hash`'s on-chain guard: evidence can only be added
 * while the dispute is `OPEN`. Also requires the authenticated caller to
 * actually own (via a linked+verified wallet) the `uploadedBy` address
 * they're attributing the file to — this doesn't replicate on-chain
 * `add_evidence_hash`'s "sender or recipient" restriction exactly (this
 * module has no cross-module read into `deliveries` to know who those are
 * without a supplementary read this codebase avoids elsewhere too), but it
 * closes the real gap a Phase 6 security review found: previously *any*
 * authenticated user could upload arbitrary content to *any* open dispute
 * under any address's name.
 */
export function createUploadEvidenceUseCase(deps: UploadEvidenceDeps) {
  return async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadEvidenceResult> {
    const dispute = await deps.disputeRepository.findByChainDeliveryId(input.chainDeliveryId);
    if (!dispute) {
      throw new DisputeNotFoundError();
    }
    if (dispute.status !== 'OPEN') {
      throw new DisputeNotOpenError();
    }

    const ownsUploader = await deps.walletOwnershipRepository.isOwnedByUser(
      input.requesterId,
      input.uploadedBy,
    );
    if (!ownsUploader) {
      throw new ForbiddenEvidenceUploadError();
    }

    // Reject files whose actual content doesn't match the declared MIME type
    // before anything is hashed or persisted (issue #394).
    assertMagicBytesMatch(input.contentType, input.bytes);

    const hash = createHash('sha256').update(input.bytes).digest('hex');
    const { storageUrl } = await deps.evidenceStorage.save({
      disputeId: dispute.id,
      contentType: input.contentType,
      bytes: input.bytes,
    });

    const evidence = await deps.evidenceRepository.create({
      disputeId: dispute.id,
      hash,
      storageUrl,
      contentType: input.contentType,
      uploadedBy: input.uploadedBy,
      // Captured once, here, at upload time — the stable identity
      // `downloadEvidence` authorizes against, immune to the `uploadedBy`
      // *address* later changing hands via wallet relinking.
      uploadedByUserId: input.requesterId,
    });

    return { evidence };
  };
}
