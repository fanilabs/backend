import { DisputeStatus, EscrowStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type {
  DisputeStatus as DomainDisputeStatus,
  EscrowStatusForDispute,
} from '../src/modules/disputes/domain/index.js';
import { ForbiddenEvidenceAccessError } from '../src/modules/disputes/domain/index.js';
import { ValidationError } from '../src/shared/errors/app-error.js';
import { testAddress } from '../src/shared/testing/addresses.js';
import { getDisputeResponseSchema } from '../src/modules/disputes/interface/schemas.js';
import { nativeToChainDisputeCase } from '../src/modules/disputes/infrastructure/disputes-scval-mapping.js';
import { createSyncDisputeFromEventUseCase } from '../src/modules/disputes/application/sync-dispute-from-event.js';
import { createDownloadEvidenceUseCase } from '../src/modules/disputes/application/download-evidence.js';
import {
  buildDispute,
  buildEvidence,
  buildEscrowDisputeEvent,
  createFakeDisputeEscrowStateReader,
  createFakeEvidenceStorage,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from '../src/modules/disputes/application/__fixtures__/fakes.js';

describe('dispute domain compatibility', () => {
  it('loads the real application exports and canonical validation error', async () => {
    const application = await import('../src/modules/disputes/application/index.js');
    for (const name of [
      'createDownloadEvidenceUseCase',
      'createUploadEvidenceUseCase',
      'createSyncDisputeFromEventUseCase',
      'createBuildDisputeTransactionsUseCases',
    ] as const) {
      expect(application[name]).toBeTypeOf('function');
    }
    const { assertFileSignatureMatchesContentType } =
      await import('../src/modules/disputes/application/file-signature.js');
    expect(() =>
      assertFileSignatureMatchesContentType(Buffer.from('not a PNG'), 'image/png'),
    ).toThrow(ValidationError);
  });

  it('keeps the persisted and API dispute status values distinct from escrow states', () => {
    expect(Object.values(DisputeStatus)).toEqual([
      'OPEN',
      'RESOLVED_REFUND',
      'RESOLVED_PAYOUT',
      'SPLIT',
    ]);
    expect(getDisputeResponseSchema.shape.data.shape.status.options).toEqual(
      Object.values(DisputeStatus),
    );
    const escrowStates: EscrowStatusForDispute[] = ['LOCKED', 'RELEASED', 'REFUNDED', 'PAUSED'];
    expect(Object.values(EscrowStatus)).toEqual(escrowStates);
  });

  it.each([
    ['Open', DisputeStatus.OPEN],
    ['ResolvedRefund', DisputeStatus.RESOLVED_REFUND],
    ['ResolvedPayout', DisputeStatus.RESOLVED_PAYOUT],
    ['Split', DisputeStatus.SPLIT],
  ])('preserves chain %s in the domain and API', (variant, status) => {
    const decoded = nativeToChainDisputeCase(
      {
        status: [variant],
        raised_by: testAddress('sender'),
        raised_at: '1767225600',
        evidence_hashes: [],
      },
      7n,
    );
    const domainStatus: DomainDisputeStatus = decoded.status;
    expect(domainStatus).toBe(status);
    expect(getDisputeResponseSchema.shape.data.shape.status.parse(domainStatus)).toBe(status);
  });

  it.each(['UNDER_REVIEW', 'RESOLVED', 'CANCELLED', 'CLOSED', 'PAUSED'])(
    'does not accept or silently map unsupported dispute status %s',
    (status) => {
      expect(getDisputeResponseSchema.shape.data.shape.status.safeParse(status).success).toBe(
        false,
      );
      expect(() => nativeToChainDisputeCase({ status: [status] }, 1n)).toThrow(
        'Unknown DisputeStatus',
      );
    },
  );

  it.each<[EscrowStatusForDispute, DomainDisputeStatus]>([
    ['LOCKED', 'OPEN'],
    ['PAUSED', 'OPEN'],
    ['RELEASED', 'RESOLVED_PAYOUT'],
    ['REFUNDED', 'RESOLVED_REFUND'],
  ])('preserves the existing escrow %s to dispute %s mapping', async (escrowStatus, expected) => {
    const disputeRepository = createInMemoryDisputeRepository();
    const escrowStateReader = createFakeDisputeEscrowStateReader();
    disputeRepository.seed(buildDispute());
    escrowStateReader.seed(1n, escrowStatus);
    const sync = createSyncDisputeFromEventUseCase({
      disputeRepository,
      escrowStateReader,
      walletOwnershipRepository: createFakeWalletOwnershipRepository(),
    });
    await sync(buildEscrowDisputeEvent({ topic: ['dispute_resolved', '1'] }));
    expect((await disputeRepository.findByChainDeliveryId(1n))?.status).toBe(expected);
  });

  it('does not grant historical raiser access to the current owner of that wallet', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    const evidenceRepository = createInMemoryEvidenceRepository();
    const walletOwnershipRepository = createFakeWalletOwnershipRepository();
    const dispute = buildDispute({ raisedByUserId: null });
    const evidence = buildEvidence({
      disputeId: dispute.id,
      uploadedByUserId: 'original-uploader',
    });
    disputeRepository.seed(dispute);
    evidenceRepository.seed(evidence);
    walletOwnershipRepository.seed('new-wallet-owner', dispute.raisedBy);
    const download = createDownloadEvidenceUseCase({
      disputeRepository,
      evidenceRepository,
      walletOwnershipRepository,
      evidenceStorage: createFakeEvidenceStorage(),
    });
    await expect(
      download({
        evidenceId: evidence.id,
        requesterId: 'new-wallet-owner',
        requesterRole: 'CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
  });
});
