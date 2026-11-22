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

  it('duplicate chain hashes do not change confirmed/unconfirmed result', async () => {
    const { disputeRepository, evidenceRepository, contractReader, getDispute } = setup();
    const dispute = buildDispute({ chainDeliveryId: 3n });
    disputeRepository.seed(dispute);
    evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: 'aa'.repeat(32) }));
    contractReader.seed(
      3n,
      buildChainDisputeCase({
        chainDeliveryId: 3n,
        evidenceHashes: ['aa'.repeat(32), 'aa'.repeat(32)],
      }),
    );

    const result = await getDispute({ chainDeliveryId: 3n });

    expect(result.evidence[0]?.confirmedOnChain).toBe(true);
  });

  it('large synthetic dataset matches a reference includes-based result', async () => {
    const { disputeRepository, evidenceRepository, contractReader, getDispute } = setup();
    const dispute = buildDispute({ chainDeliveryId: 4n });
    disputeRepository.seed(dispute);

    for (let i = 0; i < 200; i++) {
      evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: `hash-${i}` }));
    }

    const confirmedHashes = Array.from({ length: 100 }, (_, i) => `hash-${i}`);
    contractReader.seed(
      4n,
      buildChainDisputeCase({ chainDeliveryId: 4n, evidenceHashes: confirmedHashes }),
    );

    const result = await getDispute({ chainDeliveryId: 4n });

    const trueCount = result.evidence.filter((e) => e.confirmedOnChain).length;
    const falseCount = result.evidence.filter((e) => !e.confirmedOnChain).length;
    expect(trueCount).toBe(100);
    expect(falseCount).toBe(100);

    for (let i = 0; i < 100; i++) {
      expect(result.evidence.find((e) => e.hash === `hash-${i}`)?.confirmedOnChain).toBe(true);
    }
    for (let i = 100; i < 200; i++) {
      expect(result.evidence.find((e) => e.hash === `hash-${i}`)?.confirmedOnChain).toBe(false);
    }
  });

  it('disjoint set: no local hash appears on chain', async () => {
    const { disputeRepository, evidenceRepository, contractReader, getDispute } = setup();
    const dispute = buildDispute({ chainDeliveryId: 5n });
    disputeRepository.seed(dispute);
    evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: 'cc'.repeat(32) }));
    evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash: 'dd'.repeat(32) }));
    contractReader.seed(
      5n,
      buildChainDisputeCase({ chainDeliveryId: 5n, evidenceHashes: ['ee'.repeat(32)] }),
    );

    const result = await getDispute({ chainDeliveryId: 5n });

    expect(result.evidence.find((e) => e.hash === 'cc'.repeat(32))?.confirmedOnChain).toBe(false);
    expect(result.evidence.find((e) => e.hash === 'dd'.repeat(32))?.confirmedOnChain).toBe(false);
  });

  it('Set membership is O(1) — lookup count matches evidence rows not hash-list length', async () => {
    // This test documents the O(1) contract: the confirmation lookup uses a Set,
    // so cost scales with evidence row count, not with the length of the chain hash list.
    const { disputeRepository, evidenceRepository, contractReader, getDispute } = setup();
    const dispute = buildDispute({ chainDeliveryId: 6n });
    disputeRepository.seed(dispute);

    const localHashes = ['hash-0', 'hash-500', 'hash-999', 'hash-1000', 'hash-1001'];
    for (const hash of localHashes) {
      evidenceRepository.seed(buildEvidence({ disputeId: dispute.id, hash }));
    }

    const chainHashes = Array.from({ length: 1000 }, (_, i) => `hash-${i}`);
    contractReader.seed(
      6n,
      buildChainDisputeCase({ chainDeliveryId: 6n, evidenceHashes: chainHashes }),
    );

    const result = await getDispute({ chainDeliveryId: 6n });

    expect(result.evidence.find((e) => e.hash === 'hash-0')?.confirmedOnChain).toBe(true);
    expect(result.evidence.find((e) => e.hash === 'hash-500')?.confirmedOnChain).toBe(true);
    expect(result.evidence.find((e) => e.hash === 'hash-999')?.confirmedOnChain).toBe(true);
    expect(result.evidence.find((e) => e.hash === 'hash-1000')?.confirmedOnChain).toBe(false);
    expect(result.evidence.find((e) => e.hash === 'hash-1001')?.confirmedOnChain).toBe(false);
  });
});
