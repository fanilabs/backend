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
import type { ChainDisputeCase, DisputeContractReader } from '../domain/index.js';

/** Returns a different seeded `ChainDisputeCase` on each successive call,
 * so a test can assert confirmation flags are recomputed from the latest
 * chain data rather than cached from the first read. */
function createSequencedDisputeContractReader(
  responses: ChainDisputeCase[],
): DisputeContractReader {
  let call = 0;
  return {
    async getDispute() {
      const response = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return response;
    },
  };
}

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

  it('recomputes confirmedOnChain from the latest chain read on repeated calls, without mutating the stored evidence/metadata', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    const evidenceRepository = createInMemoryEvidenceRepository();

    const dispute = Object.freeze(buildDispute({ chainDeliveryId: 3n }));
    const evidenceA = Object.freeze(
      buildEvidence({ disputeId: dispute.id, hash: 'aa'.repeat(32) }),
    );
    const evidenceB = Object.freeze(
      buildEvidence({ disputeId: dispute.id, hash: 'bb'.repeat(32) }),
    );
    disputeRepository.seed(dispute);
    evidenceRepository.seed(evidenceA);
    evidenceRepository.seed(evidenceB);

    const originalDisputeSnapshot = { ...dispute };
    const originalEvidenceASnapshot = { ...evidenceA };
    const originalEvidenceBSnapshot = { ...evidenceB };

    // Second read's chain response drops hash A, adds a chain-only hash
    // that has no corresponding stored evidence row at all.
    const contractReader = createSequencedDisputeContractReader([
      buildChainDisputeCase({ chainDeliveryId: 3n, evidenceHashes: ['aa'.repeat(32)] }),
      buildChainDisputeCase({
        chainDeliveryId: 3n,
        evidenceHashes: ['bb'.repeat(32), 'cc'.repeat(32)],
      }),
    ]);

    const getDispute = createGetDisputeUseCase({
      disputeRepository,
      evidenceRepository,
      contractReader,
    });

    const first = await getDispute({ chainDeliveryId: 3n });
    expect(first.evidence.find((e) => e.hash === 'aa'.repeat(32))?.confirmedOnChain).toBe(true);
    expect(first.evidence.find((e) => e.hash === 'bb'.repeat(32))?.confirmedOnChain).toBe(false);

    const second = await getDispute({ chainDeliveryId: 3n });
    expect(second.evidence.find((e) => e.hash === 'aa'.repeat(32))?.confirmedOnChain).toBe(false);
    expect(second.evidence.find((e) => e.hash === 'bb'.repeat(32))?.confirmedOnChain).toBe(true);
    // The extra chain-only hash ('cc'...) has no stored evidence row, so it
    // cannot appear in the response at all, even though the chain reports it.
    expect(second.evidence).toHaveLength(2);

    // Repository-owned metadata is untouched by either read — frozen
    // objects would throw on write in strict mode, so getting here without
    // throwing already proves no in-place mutation; this double-checks the
    // actual values too.
    expect(dispute).toEqual(originalDisputeSnapshot);
    expect(evidenceA).toEqual(originalEvidenceASnapshot);
    expect(evidenceB).toEqual(originalEvidenceBSnapshot);
  });
});
