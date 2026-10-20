import { createHash } from 'node:crypto';
import type {
  DisputeRepository,
  EvidenceRepository,
  EvidenceStorage,
  WalletOwnershipRepository,
} from '../domain/index.js';
import {
  EvidenceIntegrityError,
  EvidenceNotFoundError,
  ForbiddenEvidenceAccessError,
} from '../domain/index.js';

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

const PARTICIPANT_ACCESSIBLE_STATUSES: ReadonlySet<string> = new Set([
  'OPEN',
  'UNDER_REVIEW',
]);

function verifyEvidenceHash(bytes: Buffer, expectedHash: string, evidenceId: string): void {
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) {
    throw new EvidenceIntegrityError(evidenceId);
  }
}

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
      verifyEvidenceHash(stored, evidence.hash, evidence.id);
      return { bytes: stored, contentType: evidence.contentType };
    }

    if (!PARTICIPANT_ACCESSIBLE_STATUSES.has(dispute.status)) {
      throw new ForbiddenEvidenceAccessError();
    }

    const isRaiser = dispute.raisedByUserId === input.requesterId;
    const isUploader = evidence.uploadedByUserId === input.requesterId;

    let isAuthorized = isRaiser || isUploader;

    if (!isAuthorized && !evidence.uploadedByUserId) {
      const ownsWallet = await walletOwnershipRepository.isOwnedByUser(
        input.requesterId,
        evidence.uploadedBy,
      );
      isAuthorized = ownsWallet;
    }

    if (!isAuthorized) {
      throw new ForbiddenEvidenceAccessError();
    }

    const stored = await evidenceStorage.read(evidence.storageUrl);
    verifyEvidenceHash(stored, evidence.hash, evidence.id);
    return { bytes: stored, contentType: evidence.contentType };
  };
}
