import type {
  CheckpointRepository,
  EventPublisher,
  EventSource,
  EventStore,
} from '../domain/index.js';

/** Fallback used only when a caller doesn't wire in a real config value (see
 * `INDEXER_EVENT_RETENTION_LEDGERS` in shared/config/env.ts) — conservative
 * floor matching the most restrictive commonly-deployed Soroban RPC events
 * retention (~24h at ~5s/ledger). */
const DEFAULT_RETENTION_WINDOW_LEDGERS = 17_280;

export interface PollContractEventsDeps {
  checkpointRepository: CheckpointRepository;
  eventStore: EventStore;
  eventSource: EventSource;
  eventPublisher: EventPublisher;
  /** How many ledgers back the RPC is guaranteed to still serve getEvents
   * for. Used to clamp a stale checkpoint forward so a poll never requests
   * a startLedger that's already aged out of the RPC's retention window
   * (Soroban RPC error -32600 "startLedger must be within the ledger
   * range"). */
  retentionWindowLedgers?: number;
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
  const retentionWindowLedgers = deps.retentionWindowLedgers ?? DEFAULT_RETENTION_WINDOW_LEDGERS;

  return async function pollContractEvents(
    input: PollContractEventsInput,
  ): Promise<PollContractEventsResult> {
    const [checkpoint, latestLedger] = await Promise.all([
      deps.checkpointRepository.get(input.contractName, input.network),
      deps.eventSource.getLatestLedger(),
    ]);

    // The oldest ledger the RPC is still guaranteed to serve getEvents for —
    // a checkpoint older than this has already aged out, so resume from
    // here instead of a doomed startLedger. A fresh contract with no
    // checkpoint yet (e.g. just redeployed) starts from the chain tip
    // rather than this floor — there's no history to catch up on.
    const retentionFloor = latestLedger - retentionWindowLedgers + 1;

    const startLedger = checkpoint
      ? Math.max(Number(checkpoint.lastLedgerSeq) + 1, retentionFloor)
      : latestLedger;

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
