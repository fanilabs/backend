import type { Checkpoint, RawContractEvent, StoredEvent } from './entities.js';

export interface CheckpointRepository {
  get(contractName: string, network: string): Promise<Checkpoint | null>;
  advance(contractName: string, network: string, lastLedgerSeq: bigint): Promise<void>;
}

/**
 * `tryInsert` returns `false` for an event whose `(contractName, network,
 * rpcEventId)` already exists instead of throwing — re-polling an
 * overlapping ledger range must be a harmless no-op, not an error
 * (ARCHITECTURE.md §6 / docs/EVENT_INDEXER.md).
 */
export interface EventStore {
  tryInsert(event: StoredEvent): Promise<boolean>;
  remove?(event: StoredEvent): Promise<void>;
}

export interface FetchEventsResult {
  events: RawContractEvent[];
  /** The latest ledger the RPC actually considered, even if it contained no
   * matching events — advancing the checkpoint to this (not just the last
   * event's ledger) is what lets an empty polling window still make progress. */
  latestLedgerSeen: number;
}

export interface EventSource {
  getLatestLedger(): Promise<number>;
  fetchEvents(input: { contractId: string; startLedger: number }): Promise<FetchEventsResult>;
}

/**
 * In-process publish point for durably-stored events — module handlers
 * (deliveries, escrow, disputes, ...) subscribe here once they exist
 * (ARCHITECTURE.md §11: not a distributed bus in v1). Publishing to zero
 * listeners is normal, not premature.
 *
 * May be asynchronous: the in-process bus bounds subscriber concurrency and
 * returns a promise that settles only once every subscriber has finished.
 * `pollContractEvents` awaits it before advancing the checkpoint, so a batch
 * is fully handled by every subscriber before the next batch is ingested
 * (issue #349 — backpressure for event replay / post-downtime catch-up).
 */
export interface EventPublisher {
  publish(event: StoredEvent): void | Promise<void>;
}
