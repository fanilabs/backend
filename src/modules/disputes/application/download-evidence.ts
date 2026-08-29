import type {
  DisputeRepository,
  EvidenceRepository,
  EvidenceStorage,
  UserRole,
  WalletOwnershipRepository,
} from '../domain/index.js';
import { EvidenceNotFoundError, ForbiddenEvidenceAccessError } from '../domain/index.js';

export interface DownloadEvidenceDeps {
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
  disputeRepository: DisputeRepository;
  walletOwnershipRepository: WalletOwnershipRepository;
}

export interface DownloadEvidenceInput {
  evidenceId: string;
  requesterId: string;
  requesterRole: UserRole;
}

export interface DownloadEvidenceResult {
  contentType: string;
  bytes: Buffer;
}

/**
 * Phase 6 security review finding: this previously had no access check at
 * all beyond "is authenticated" — any registered user could download any
 * dispute's evidence file given only its id, itself discoverable via the
 * public `GET /disputes/:chainDeliveryId` (which lists every evidence
 * item's id). Now restricted to `ADMIN`, whoever uploaded the item (via
 * their linked wallet), or whoever raised the dispute it belongs to —
 * the raiser can review evidence the other party submitted, not just
 * their own.
 */
export function createDownloadEvidenceUseCase(deps: DownloadEvidenceDeps) {
  return async function downloadEvidence(
    input: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = await deps.evidenceRepository.findById(input.evidenceId);
    if (!evidence) {
      throw new EvidenceNotFoundError();
    }

    if (input.requesterRole !== 'ADMIN') {
      const dispute = await deps.disputeRepository.findById(evidence.disputeId);
      // `dispute.raisedBy` is guaranteed to be a real Stellar address by the
      // sync layer (sync-dispute-from-event.ts's upsertResolution skips
      // writing a resolution rather than falling back to a non-address
      // sentinel) — the only null-safety this check needs is for `dispute`
      // itself possibly not existing.
      const [ownsUploader, ownsRaiser] = await Promise.all([
        deps.walletOwnershipRepository.isOwnedByUser(input.requesterId, evidence.uploadedBy),
        dispute
          ? deps.walletOwnershipRepository.isOwnedByUser(input.requesterId, dispute.raisedBy)
          : Promise.resolve(false),
      ]);
      if (!ownsUploader && !ownsRaiser) {
        throw new ForbiddenEvidenceAccessError();
      }
    }

    const bytes = await deps.evidenceStorage.read(evidence.storageUrl);
    return { contentType: evidence.contentType, bytes };
  };
}
