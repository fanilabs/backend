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
    });

    return { evidence };
  };
}
