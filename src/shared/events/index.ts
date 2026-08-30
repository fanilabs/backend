import { EventEmitter } from 'node:events';
import type { Logger } from '../logger/index.js';

export { parseAddress, parseBigIntId } from './parse.js';

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
  /** On-chain ledger close time — use this, not `new Date()`, when a
   * handler needs an on-chain timestamp. */
  closedAt: Date;
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

/**
 * The six-line subscription boilerplate every module's
 * infrastructure/event-subscription.ts used to repeat: subscribe to the bus,
 * invoke the module's async handler, and catch+log the rejection.
 * `onBlockchainEvent`'s callback is synchronous, so the async handler's
 * rejection must be caught here rather than becoming an unhandled promise
 * rejection — one malformed/unexpected event must not crash the process or
 * block subsequent events (docs/EVENT_INDEXER.md's malformed-event handling).
 */
export function subscribeBlockchainEventHandler(
  handler: (event: BlockchainEventEnvelope) => Promise<unknown>,
  log: Logger,
  errorMessage: string,
): () => void {
  return onBlockchainEvent((event) => {
    handler(event).catch((error: unknown) => {
      log.error({ err: error, event }, errorMessage);
    });
  });
}
