import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createUploadEvidenceUseCase } from './upload-evidence.js';
import {
  buildDispute,
  createFakeEvidenceStorage,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from './__fixtures__/fakes.js';
import {
  DisputeNotFoundError,
  DisputeNotOpenError,
  ForbiddenEvidenceUploadError,
} from '../domain/index.js';

function setup() {
  const disputeRepository = createInMemoryDisputeRepository();
  const evidenceRepository = createInMemoryEvidenceRepository();
  const evidenceStorage = createFakeEvidenceStorage();
  const walletOwnershipRepository = createFakeWalletOwnershipRepository();
  const uploadEvidence = createUploadEvidenceUseCase({
    disputeRepository,
    evidenceRepository,
    evidenceStorage,
    walletOwnershipRepository,
  });
  return {
    disputeRepository,
    evidenceRepository,
    evidenceStorage,
    walletOwnershipRepository,
    uploadEvidence,
  };
}

describe('uploadEvidence', () => {
  it('throws DisputeNotFoundError for an unknown delivery id', async () => {
    const { uploadEvidence } = setup();

    await expect(
      uploadEvidence({
        chainDeliveryId: 999n,
        contentType: 'image/png',
        uploadedBy: 'GSENDER',
        bytes: Buffer.from('data'),
        requesterId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(DisputeNotFoundError);
  });

  it('throws DisputeNotOpenError once the dispute is no longer OPEN', async () => {
    const { disputeRepository, uploadEvidence } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'RESOLVED_REFUND' }));

    await expect(
      uploadEvidence({
        chainDeliveryId: 1n,
        contentType: 'image/png',
        uploadedBy: 'GSENDER',
        bytes: Buffer.from('data'),
        requesterId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(DisputeNotOpenError);
  });

  it('throws ForbiddenEvidenceUploadError when the requester does not own the claimed uploadedBy address', async () => {
    const { disputeRepository, uploadEvidence } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));

    await expect(
      uploadEvidence({
        chainDeliveryId: 1n,
        contentType: 'image/png',
        uploadedBy: 'GVICTIM',
        bytes: Buffer.from('data'),
        requesterId: 'attacker-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceUploadError);
  });

  it('stores the file and records the sha256 hex hash matching the bytes, once the requester owns uploadedBy', async () => {
    const { disputeRepository, walletOwnershipRepository, uploadEvidence } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, status: 'OPEN' });
    disputeRepository.seed(dispute);
    walletOwnershipRepository.seed('user-1', 'GSENDER');
    const bytes = Buffer.from('evidence-file-contents');
    const expectedHash = createHash('sha256').update(bytes).digest('hex');

    const result = await uploadEvidence({
      chainDeliveryId: 1n,
      contentType: 'application/pdf',
      uploadedBy: 'GSENDER',
      bytes,
      requesterId: 'user-1',
    });

    expect(result.evidence.hash).toBe(expectedHash);
    expect(result.evidence.disputeId).toBe(dispute.id);
    expect(result.evidence.storageUrl).toContain(dispute.id);
  });
});
