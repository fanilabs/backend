import { describe, expect, it } from 'vitest';
import { createGetDisputeUseCase } from './get-dispute.js';
import {
  buildChainDisputeCase,
  buildDispute,
  buildEvidence,
  createFakeDisputeContractReader,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from './__fixtures__/fakes.js';
import { DisputeNotFoundError } from '../domain/index.js';

function setup() {
  const disputeRepository = createInMemoryDisputeRepository();
  const evidenceRepository = createInMemoryEvidenceRepository();
  const contractReader = createFakeDisputeContractReader();
  const getDispute = createGetDisputeUseCase({
    disputeRepository,
    evidenceRepository,
    contractReader,
  });
  return { disputeRepository, evidenceRepository, contractReader, getDispute };
}

describe('getDispute', () => {
  it('throws DisputeNotFoundError when no dispute is indexed for that delivery', async () => {
    const { getDispute } = setup();

    await expect(getDispute({ chainDeliveryId: 999n })).rejects.toBeInstanceOf(
      DisputeNotFoundError,
    );
  });

  it('marks evidence confirmedOnChain when its hash appears in the on-chain evidence_hashes', async () => {
    const { disputeRepository, evidenceRepository, contractReader, getDispute } = setup();
    const dispute = buildDispute({ chainDeliveryId: 1n });
    disputeRepository.seed(dispute);
    evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: 'aa'.repeat(32) }));
    evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: 'bb'.repeat(32) }));
    contractReader.seed(
      1n,
      buildChainDisputeCase({ chainDeliveryId: 1n, evidenceHashes: ['aa'.repeat(32)] }),
    );

    const result = await getDispute({ chainDeliveryId: 1n });

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.find((e) => e.hash === 'aa'.repeat(32))?.confirmedOnChain).toBe(true);
    expect(result.evidence.find((e) => e.hash === 'bb'.repeat(32))?.confirmedOnChain).toBe(false);
  });

  it('reports every evidence row unconfirmed, without throwing, when no on-chain case exists (Layer-A-only dispute)', async () => {
    const { disputeRepository, evidenceRepository, getDispute } = setup();
    const dispute = buildDispute({ chainDeliveryId: 2n });
    disputeRepository.seed(dispute);
    evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: 'cc'.repeat(32) }));
    // No contractReader.seed(2n, ...) — get_dispute would revert on-chain.

    const result = await getDispute({ chainDeliveryId: 2n });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.confirmedOnChain).toBe(false);
  });
});
