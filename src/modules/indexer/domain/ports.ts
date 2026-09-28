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
 * (ARCHITECTURE.md §11: not a distributed bus in v1). No subscribers exist
 * yet in this phase; publishing to zero listeners is normal, not premature.
 */
export interface EventPublisher {
  publish(event: StoredEvent): void;
}
