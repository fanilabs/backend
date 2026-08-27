import type { CheckpointRepository, EventSource } from '../domain/index.js';

export interface GetIndexerHealthDeps {
  checkpointRepository: CheckpointRepository;
  eventSource: EventSource;
}

export interface TrackedContract {
  contractName: string;
  contractId: string | undefined;
}

export interface GetIndexerHealthInput {
  network: string;
  trackedContracts: TrackedContract[];
  lagAlertThreshold: number;
}

export interface ContractHealth {
  contractName: string;
  configured: boolean;
  lastLedgerSeq: string | null;
  lagLedgers: number | null;
  healthy: boolean;
}

export interface GetIndexerHealthResult {
  latestLedger: number;
  healthy: boolean;
  contracts: ContractHealth[];
}

/**
 * `now_ledger - lastLedgerSeq` per tracked contract — the "indexer lag as a
 * first-class health signal" pattern from PHASE_2_REFERENCE_ANALYSIS.md §3.
 * A contract with no configured id is reported (not omitted) as
 * `configured: false` and counted healthy, since "not deployed yet" isn't
 * a failure — see .env.example, contract ids are blank by default.
 */
export function createGetIndexerHealthUseCase(deps: GetIndexerHealthDeps) {
  return async function getIndexerHealth(
    input: GetIndexerHealthInput,
  ): Promise<GetIndexerHealthResult> {
    const latestLedger = await deps.eventSource.getLatestLedger();

    const contracts: ContractHealth[] = [];
    for (const tracked of input.trackedContracts) {
      if (!tracked.contractId) {
        contracts.push({
          contractName: tracked.contractName,
          configured: false,
          lastLedgerSeq: null,
          lagLedgers: null,
          healthy: true,
        });
        continue;
      }

      const checkpoint = await deps.checkpointRepository.get(tracked.contractName, input.network);
      const lagLedgers = checkpoint ? latestLedger - Number(checkpoint.lastLedgerSeq) : null;

      contracts.push({
        contractName: tracked.contractName,
        configured: true,
        lastLedgerSeq: checkpoint ? checkpoint.lastLedgerSeq.toString() : null,
        lagLedgers,
        healthy: lagLedgers === null ? true : lagLedgers <= input.lagAlertThreshold,
      });
    }

    return { latestLedger, healthy: contracts.every((contract) => contract.healthy), contracts };
  };
}
