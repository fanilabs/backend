import { EventEmitter } from 'node:events';

/**
 * Every durably-stored blockchain event, after decoding, in one shape —
 * module handlers (deliveries, escrow, disputes, ...) subscribe here once
 * they exist. Deliberately in-process only for v1, not a distributed bus
 * (ARCHITECTURE.md §11) — if the indexer ever needs to run as more than one
 * instance, this is the seam to swap for Redis Streams or similar.
 */
export interface BlockchainEventEnvelope {
  contractName: string;
  network: string;
  rpcEventId: string;
  ledgerSeq: bigint;
  txHash: string;
  topic: string[];
  payload: unknown;
}

const CHANNEL = 'blockchain-event';

const bus = new EventEmitter();
// Generous default — every future module that consumes blockchain events
// (deliveries, escrow, disputes, reputation, fleet, notifications,
// fraud-detection per ARCHITECTURE.md §10) subscribes on this one channel.
bus.setMaxListeners(50);

export function publishBlockchainEvent(event: BlockchainEventEnvelope): void {
  bus.emit(CHANNEL, event);
}

/** Returns an unsubscribe function — call it on module/test teardown. */
export function onBlockchainEvent(handler: (event: BlockchainEventEnvelope) => void): () => void {
  bus.on(CHANNEL, handler);
  return () => {
    bus.off(CHANNEL, handler);
  };
}
