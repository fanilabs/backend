import type {
  CheckpointRepository,
  EventPublisher,
  EventSource,
  EventStore,
} from '../domain/index.js';

export interface PollContractEventsDeps {
  checkpointRepository: CheckpointRepository;
  eventStore: EventStore;
  eventSource: EventSource;
  eventPublisher: EventPublisher;
}

export interface PollContractEventsInput {
  contractName: string;
  contractId: string;
  network: string;
}

export interface PollContractEventsResult {
  eventsFetched: number;
  eventsInserted: number;
  lastLedgerSeq: bigint;
}

/**
 * One poll cycle for one contract: resume from the persisted checkpoint (or
 * start from the current chain tip on first run — no historical backfill,
 * see docs/EVENT_INDEXER.md), fetch new events, durably and idempotently
 * store each one, publish only the ones that were actually new, then
 * advance the checkpoint. The checkpoint only ever moves forward after
 * every event in the batch is safely persisted, so a crash mid-batch can't
 * skip anything on the next run.
 */
export function createPollContractEventsUseCase(deps: PollContractEventsDeps) {
  return async function pollContractEvents(
    input: PollContractEventsInput,
  ): Promise<PollContractEventsResult> {
    const checkpoint = await deps.checkpointRepository.get(input.contractName, input.network);

    const startLedger = checkpoint
      ? Number(checkpoint.lastLedgerSeq) + 1
      : await deps.eventSource.getLatestLedger();

    const { events, latestLedgerSeen } = await deps.eventSource.fetchEvents({
      contractId: input.contractId,
      startLedger,
    });

    let eventsInserted = 0;
    for (const event of events) {
      const stored = {
        contractName: input.contractName,
        network: input.network,
        rpcEventId: event.rpcEventId,
        ledgerSeq: BigInt(event.ledgerSeq),
        txHash: event.txHash,
        topic: event.topic,
        payload: event.value,
        closedAt: event.closedAt,
      };

      const inserted = await deps.eventStore.tryInsert(stored);
      if (inserted) {
        eventsInserted += 1;
        deps.eventPublisher.publish(stored);
      }
    }

    const lastLedgerSeq = BigInt(Math.max(latestLedgerSeen, startLedger - 1));
    await deps.checkpointRepository.advance(input.contractName, input.network, lastLedgerSeq);

    return { eventsFetched: events.length, eventsInserted, lastLedgerSeq };
  };
}
