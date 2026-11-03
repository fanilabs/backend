import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
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
    const {
      disputeRepository,
      walletOwnershipRepository,
      evidenceRepository,
      evidenceStorage,
      uploadEvidence,
    } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, status: 'OPEN' });
    disputeRepository.seed(dispute);
    walletOwnershipRepository.seed('user-1', 'GSENDER');
    const bytes = Buffer.from('%PDF-1.7\nevidence-file-contents');
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
    expect(result.evidence).toMatchObject({
      contentType: 'application/pdf',
      uploadedBy: 'GSENDER',
      uploadedByUserId: 'user-1',
    });
    expect(await evidenceRepository.findById(result.evidence.id)).toEqual(result.evidence);
    expect(await evidenceStorage.read(result.evidence.storageUrl)).toEqual(bytes);
  });

  it("records the requester's account id as uploadedByUserId (wallet-relink evidence authorization)", async () => {
    const { disputeRepository, walletOwnershipRepository, evidenceRepository, uploadEvidence } =
      setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));
    walletOwnershipRepository.seed('user-1', 'GSENDER');

    const result = await uploadEvidence({
      chainDeliveryId: 1n,
      contentType: 'application/pdf',
      uploadedBy: 'GSENDER',
      bytes: Buffer.from('%PDF-1.7\nevidence-file-contents'),
      requesterId: 'user-1',
    });

    expect(result.evidence.uploadedByUserId).toBe('user-1');
    expect((await evidenceRepository.findById(result.evidence.id))?.uploadedByUserId).toBe(
      'user-1',
    );
  });
  it('propagates a storage failure without creating an evidence row', async () => {
    const deps = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, status: 'OPEN' });
    deps.disputeRepository.seed(dispute);
    deps.walletOwnershipRepository.seed('user-1', 'GSENDER');
    const failure = new Error('isolated storage failure');
    vi.spyOn(deps.evidenceStorage, 'save').mockRejectedValueOnce(failure);
    const create = vi.spyOn(deps.evidenceRepository, 'create');

    await expect(
      deps.uploadEvidence({
        chainDeliveryId: 1n,
        contentType: 'application/pdf',
        uploadedBy: 'GSENDER',
        requesterId: 'user-1',
        bytes: Buffer.from('%PDF-1.7\nsynthetic storage fixture'),
      }),
    ).rejects.toBe(failure);
    expect(create).not.toHaveBeenCalled();
    expect(await deps.evidenceRepository.listByDisputeId(dispute.id)).toEqual([]);
  });

  it('propagates a persistence failure after saving; the test cleans up its fixture bytes', async () => {
    const deps = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n, status: 'OPEN' });
    deps.disputeRepository.seed(dispute);
    deps.walletOwnershipRepository.seed('user-1', 'GSENDER');
    const failure = new Error('isolated repository failure');
    vi.spyOn(deps.evidenceRepository, 'create').mockRejectedValueOnce(failure);
    const originalSave = deps.evidenceStorage.save;
    let storageUrl: string | undefined;
    const save = vi.spyOn(deps.evidenceStorage, 'save').mockImplementation(async (input) => {
      const saved = await originalSave(input);
      storageUrl = saved.storageUrl;
      return saved;
    });
    const bytes = Buffer.from('%PDF-1.7\nsynthetic persistence fixture');
    try {
      await expect(
        deps.uploadEvidence({
          chainDeliveryId: 1n,
          contentType: 'application/pdf',
          uploadedBy: 'GSENDER',
          requesterId: 'user-1',
          bytes,
        }),
      ).rejects.toBe(failure);
      expect(save).toHaveBeenCalledExactlyOnceWith({
        disputeId: dispute.id,
        contentType: 'application/pdf',
        bytes,
      });
      expect(await deps.evidenceRepository.listByDisputeId(dispute.id)).toEqual([]);
    } finally {
      // Fixture teardown only, not a claim of production compensation policy.
      if (storageUrl !== undefined) await deps.evidenceStorage.delete(storageUrl);
    }
  });
});
