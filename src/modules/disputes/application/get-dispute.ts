import { logger } from '../../../shared/logger/index.js';
import type {
  Dispute,
  DisputeContractReader,
  DisputeRepository,
  Evidence,
  EvidenceRepository,
} from '../domain/index.js';
import { DisputeNotFoundError } from '../domain/index.js';

const log = logger.child({ module: 'get-dispute' });

export interface GetDisputeDeps {
  disputeRepository: DisputeRepository;
  evidenceRepository: EvidenceRepository;
  contractReader: DisputeContractReader;
}

export interface GetDisputeInput {
  chainDeliveryId: bigint;
}

export interface EvidenceWithVerification extends Evidence {
  /** `true` only if this exact hash appears in the chain's current
   * `evidence_hashes` for this dispute — the "content-hash-verified against
   * the on-chain evidence hash" requirement (ROADMAP.md §2 objective 5),
   * checked at read time rather than cached, since the chain is always the
   * source of truth for what was actually recorded. */
  confirmedOnChain: boolean;
}

export interface GetDisputeResult {
  dispute: Dispute;
  evidence: EvidenceWithVerification[];
}

/**
 * A dispute may exist in this read model without ever having a
 * `dispute_resolution_contract` case (raised purely through
 * `escrow_contract`'s Layer A — see `sync-dispute-from-event.ts`), in which
 * case `get_dispute` reverts on-chain. That's treated as "no chain
 * confirmation available", not an error — every evidence row is reported
 * unconfirmed rather than the whole read failing.
 */
export function createGetDisputeUseCase(deps: GetDisputeDeps) {
  return async function getDispute(input: GetDisputeInput): Promise<GetDisputeResult> {
    const dispute = await deps.disputeRepository.findByChainDeliveryId(input.chainDeliveryId);
    if (!dispute) {
      throw new DisputeNotFoundError();
    }

    const evidence = await deps.evidenceRepository.listByDisputeId(dispute.id);

    let onChainHashes: string[] = [];
    try {
      const chainCase = await deps.contractReader.getDispute(input.chainDeliveryId);
      onChainHashes = chainCase.evidenceHashes;
    } catch (error: unknown) {
      log.debug(
        { err: error, chainDeliveryId: input.chainDeliveryId.toString() },
        'No on-chain dispute_resolution_contract case for this delivery — evidence reported unconfirmed',
      );
    }

    return {
      dispute,
      evidence: evidence.map((item) => ({
        ...item,
        confirmedOnChain: onChainHashes.includes(item.hash),
      })),
    };
  };
}
