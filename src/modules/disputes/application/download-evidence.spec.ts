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
    const { evidenceRepository, disputeRepository, evidenceStorage, downloadEvidence } = setup();
    const dispute = buildDispute({
      chainDeliveryId: 1n,
      raisedBy: 'GRAISER',
      raisedByUserId: 'raiser-user',
    });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GOTHERPARTY',
      storageUrl: 'fake://d/2',
    });
    evidenceRepository.seed(evidence);
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
    const { evidenceRepository, disputeRepository, evidenceStorage, downloadEvidence } = setup();
    const dispute = buildDispute({
      chainDeliveryId: 1n,
      raisedBy: 'GRAISER',
      raisedByUserId: 'raiser-user',
    });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GRAISER',
      storageUrl: 'fake://d/1',
      contentType: 'image/png',
    });
    evidenceRepository.seed(evidence);
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
    // Evidence uploaded by 'original-user' while they owned GORIGINAL_OWNER
    // — uploadedByUserId is what makes this a *current* (non-legacy)
    // evidence row, captured once at upload time and never re-derived.
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GORIGINAL_OWNER',
      uploadedByUserId: 'original-user',
      storageUrl: 'fake://d/transfer-test',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/transfer-test', Buffer.from('confidential-data'));

    // GORIGINAL_OWNER's wallet link later ends and a *different* account
    // links the same address — current wallet ownership now belongs to
    // new-owner-user, but that must not translate into evidence access.
    walletOwnershipRepository.seed('new-owner-user', 'GORIGINAL_OWNER');

    await expect(
      downloadEvidence({
        evidenceId: evidence.id,
        requesterId: 'new-owner-user',
        requesterRole: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
  });

  it('the original uploader keeps access via uploadedByUserId after their wallet is relinked to someone else', async () => {
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
      uploadedByUserId: 'original-user',
      storageUrl: 'fake://d/still-mine',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/still-mine', Buffer.from('confidential-data'));

    // original-user no longer owns the wallet at all (relinked away) — the
    // wallet-ownership repository has no seed for them — yet they must
    // still be able to read their own historical evidence.
    walletOwnershipRepository.seed('new-owner-user', 'GORIGINAL_OWNER');

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'original-user',
      requesterRole: 'CUSTOMER',
    });

    expect(result.bytes).toEqual(Buffer.from('confidential-data'));
  });

  it('legacy evidence (uploaded before uploadedByUserId existed) still authorizes via current wallet ownership', async () => {
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
      uploadedBy: 'GLEGACY',
      uploadedByUserId: null,
      storageUrl: 'fake://d/legacy',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/legacy', Buffer.from('legacy-data'));
    walletOwnershipRepository.seed('legacy-owner', 'GLEGACY');

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'legacy-owner',
      requesterRole: 'CUSTOMER',
    });

    expect(result.bytes).toEqual(Buffer.from('legacy-data'));
  });

  // ── Raiser wallet-relink evidence authorization (B2.1) ──────────────────
  // Same class of bug as the uploader tests above, for the raiser-access
  // branch: User A raises a dispute with wallet X, later unlinks X, and a
  // different User B links X. B must not inherit A's raiser-based evidence
  // access just by currently controlling that address.

  it('prevents raiser-based access when a different user claims a wallet that was previously linked by the raiser', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    // User A ("original-raiser") raised this dispute while owning GRAISER —
    // raisedByUserId is what makes this a *current* (non-legacy) dispute
    // row, captured once when the dispute was first observed and never
    // re-derived.
    const dispute = buildDispute({
      chainDeliveryId: 1n,
      raisedBy: 'GRAISER',
      raisedByUserId: 'original-raiser',
    });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GOTHERPARTY',
      storageUrl: 'fake://d/raiser-transfer-test',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/raiser-transfer-test', Buffer.from('confidential-data'));

    // GRAISER's wallet link later ends and a *different* account links the
    // same address — current wallet ownership now belongs to
    // new-owner-user, but that must not translate into raiser-based
    // evidence access.
    walletOwnershipRepository.seed('new-owner-user', 'GRAISER');

    await expect(
      downloadEvidence({
        evidenceId: evidence.id,
        requesterId: 'new-owner-user',
        requesterRole: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
  });

  it('the original raiser keeps access via raisedByUserId after their wallet is relinked to someone else', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    const dispute = buildDispute({
      chainDeliveryId: 1n,
      raisedBy: 'GRAISER',
      raisedByUserId: 'original-raiser',
    });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GOTHERPARTY',
      storageUrl: 'fake://d/raiser-still-mine',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/raiser-still-mine', Buffer.from('confidential-data'));

    // original-raiser no longer owns GRAISER at all (relinked away) — the
    // wallet-ownership repository has no seed for them — yet they must
    // still be able to read evidence through their raiser authorization.
    walletOwnershipRepository.seed('new-owner-user', 'GRAISER');

    const result = await downloadEvidence({
      evidenceId: evidence.id,
      requesterId: 'original-raiser',
      requesterRole: 'CUSTOMER',
    });

    expect(result.bytes).toEqual(Buffer.from('confidential-data'));
  });

  it('legacy disputes (raised before raisedByUserId existed) do not grant raiser-based access via current wallet ownership', async () => {
    const {
      evidenceRepository,
      disputeRepository,
      walletOwnershipRepository,
      evidenceStorage,
      downloadEvidence,
    } = setup();
    const dispute = buildDispute({
      chainDeliveryId: 1n,
      raisedBy: 'GLEGACYRAISER',
      raisedByUserId: null,
    });
    disputeRepository.seed(dispute);
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedBy: 'GOTHERPARTY',
      storageUrl: 'fake://d/raiser-legacy',
    });
    evidenceRepository.seed(evidence);
    evidenceStorage.seed('fake://d/raiser-legacy', Buffer.from('confidential-data'));
    // Unlike the uploader's legacy fallback, current wallet ownership of
    // the raiser address must NOT grant access even though this is the
    // only wallet-ownership record available — see downloadEvidence's doc
    // comment for why that fallback would recreate the vulnerability.
    walletOwnershipRepository.seed('current-owner', 'GLEGACYRAISER');

    await expect(
      downloadEvidence({
        evidenceId: evidence.id,
        requesterId: 'current-owner',
        requesterRole: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
  });
});
