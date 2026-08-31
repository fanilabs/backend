import { describe, expect, it } from 'vitest';
import { createDownloadEvidenceUseCase } from './download-evidence.js';
import {
  buildDispute,
  buildEvidence,
  createFakeEvidenceStorage,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from './__fixtures__/fakes.js';
import { EvidenceNotFoundError, ForbiddenEvidenceAccessError } from '../domain/index.js';

function setup() {
  const evidenceRepository = createInMemoryEvidenceRepository();
  const evidenceStorage = createFakeEvidenceStorage();
  const disputeRepository = createInMemoryDisputeRepository();
  const walletOwnershipRepository = createFakeWalletOwnershipRepository();
  const downloadEvidence = createDownloadEvidenceUseCase({
    evidenceRepository,
    evidenceStorage,
    disputeRepository,
    walletOwnershipRepository,
  });
  return {
    evidenceRepository,
    evidenceStorage,
    disputeRepository,
    walletOwnershipRepository,
    downloadEvidence,
  };
}

describe('downloadEvidence', () => {
  it('throws EvidenceNotFoundError for an unknown id', async () => {
    const { downloadEvidence } = setup();

    await expect(
      downloadEvidence({ evidenceId: 'missing', requesterId: 'user-1', requesterRole: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(EvidenceNotFoundError);
  });

  it('throws ForbiddenEvidenceAccessError for an unrelated authenticated user', async () => {
    const { evidenceRepository, disputeRepository, downloadEvidence } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, raisedBy: 'GRAISER' });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({ disputeId: dispute.id, uploadedBy: 'GUPLOADER' });
    evidenceRepository.seed(evidence);

    await expect(
      downloadEvidence({
        evidenceId: evidence.id,
        requesterId: 'stranger-1',
        requesterRole: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
  });

  it('allows the user who owns the uploadedBy address', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, raisedBy: 'GRAISER' });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GUPLOADER',
      storageUrl: 'fake://d/1',
    });
    evidenceRepository.seed(evidence);
    walletOwnershipRepository.seed('uploader-user', 'GUPLOADER');
    evidenceStorage.seed('fake://d/1', Buffer.from('file-bytes'));

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'uploader-user',
      requesterRole: 'CUSTOMER',
    });

    expect(result.bytes).toEqual(Buffer.from('file-bytes'));
  });

  it('allows the user who raised the dispute, even for evidence someone else uploaded', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, raisedBy: 'GRAISER' });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GOTHERPARTY',
      storageUrl: 'fake://d/2',
    });
    evidenceRepository.seed(evidence);
    walletOwnershipRepository.seed('raiser-user', 'GRAISER');
    evidenceStorage.seed('fake://d/2', Buffer.from('other-party-file'));

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'raiser-user',
      requesterRole: 'CUSTOMER',
    });

    expect(result.bytes).toEqual(Buffer.from('other-party-file'));
  });

  it('allows ADMIN regardless of wallet ownership', async () => {
    const { evidenceRepository, disputeRepository, evidenceStorage, downloadEvidence } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, raisedBy: 'GRAISER' });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GUPLOADER',
      storageUrl: 'fake://d/3',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/3', Buffer.from('admin-visible'));

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'admin-user',
      requesterRole: 'ADMIN',
    });

    expect(result.bytes).toEqual(Buffer.from('admin-visible'));
  });

  it('returns the stored bytes and content type', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, raisedBy: 'GRAISER' });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GRAISER',
      storageUrl: 'fake://d/1',
      contentType: 'image/png',
    });
    evidenceRepository.seed(evidence);
    walletOwnershipRepository.seed('raiser-user', 'GRAISER');
    const bytes = Buffer.from('file-bytes');
    evidenceStorage.seed('fake://d/1', bytes);

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'raiser-user',
      requesterRole: 'CUSTOMER',
    });

    expect(result.bytes).toEqual(bytes);
    expect(result.contentType).toBe('image/png');
  });

  it('prevents access when a different user claims a wallet that was previously linked by the uploader', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, raisedBy: 'GRAISER' });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GORIGINAL_OWNER',
      storageUrl: 'fake://d/transfer-test',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/transfer-test', Buffer.from('confidential-data'));

    walletOwnershipRepository.seed('original-user', 'GORIGINAL_OWNER');
    walletOwnershipRepository.seed('new-owner-user', 'GORIGINAL_OWNER');

    await expect(
      downloadEvidence({
        evidenceId: evidence.id,
        requesterId: 'new-owner-user',
        requesterRole: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
  });
});
