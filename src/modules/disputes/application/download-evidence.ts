import type {
  DisputeRepository,
  DisputeStatus,
  EvidenceRepository,
  EvidenceStorage,
  WalletOwnershipRepository,
} from '../domain/index.js';
import { EvidenceNotFoundError, ForbiddenEvidenceAccessError } from '../domain/index.js';

export interface DownloadEvidenceInput {
  evidenceId: string;
  requesterId: string;
  requesterRole: string;
}

export interface DownloadEvidenceResult {
  bytes: Buffer;
  contentType: string;
}

export interface DownloadEvidenceDeps {
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
  disputeRepository: DisputeRepository;
  walletOwnershipRepository: WalletOwnershipRepository;
}

/**
 * The persisted dispute state in which evidence remains downloadable by
 * dispute participants. Once a dispute is resolved,
 * evidence is no longer exposed to participants — only ADMIN retains access.
 */
const PARTICIPANT_ACCESSIBLE_STATUSES: ReadonlySet<DisputeStatus> = new Set(['OPEN']);

export function createDownloadEvidenceUseCase(deps: DownloadEvidenceDeps) {
  const { evidenceRepository, evidenceStorage, disputeRepository, walletOwnershipRepository } =
    deps;

  return async function downloadEvidence(
    input: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = await evidenceRepository.findById(input.evidenceId);
    if (!evidence) {
      throw new EvidenceNotFoundError();
    }

    const dispute = await disputeRepository.findById(evidence.disputeId);
    if (!dispute) {
      throw new EvidenceNotFoundError();
    }

    if (input.requesterRole === 'ADMIN') {
      const stored = await evidenceStorage.read(evidence.storageUrl);
      return { bytes: stored, contentType: evidence.contentType };
    }

    // Lifecycle gate: participants may only download evidence while OPEN.
    // All three persisted resolution outcomes remain restricted to ADMIN.
    if (!PARTICIPANT_ACCESSIBLE_STATUSES.has(dispute.status)) {
      throw new ForbiddenEvidenceAccessError();
    }

    const isRaiser = dispute.raisedByUserId === input.requesterId;
    const isUploader = evidence.uploadedByUserId === input.requesterId;

    let isAuthorized = isRaiser || isUploader;

    if (!isAuthorized) {
      // Legacy evidence rows (no uploadedByUserId captured at upload time)
      // fall back to current wallet ownership of the uploadedBy address.
      if (!evidence.uploadedByUserId) {
        const ownsWallet = await walletOwnershipRepository.isOwnedByUser(
          input.requesterId,
          evidence.uploadedBy,
        );
        isAuthorized = ownsWallet;
      }
    }

    if (!isAuthorized) {
      throw new ForbiddenEvidenceAccessError();
    }

    const stored = await evidenceStorage.read(evidence.storageUrl);
    return { bytes: stored, contentType: evidence.contentType };
  };
}
