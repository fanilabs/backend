import type { SorobanClient } from '../../../blockchain/soroban-client.js';
import { scValToNative } from '../../../blockchain/xdr/sc-val.js';
import type { EventSource, FetchEventsResult, RawContractEvent } from '../domain/index.js';

/**
 * Real EventSource implementation of the indexer domain port, backed by the
 * shared resilient Soroban RPC client (retry + circuit breaker already
 * built in — this file adds no retry logic of its own). Decodes each raw
 * RPC event's topic/value XDR into native values via scValToNative so
 * nothing downstream ever touches xdr.ScVal directly.
 */
export function createSorobanEventSource(client: SorobanClient): EventSource {
  return {
    async getLatestLedger() {
      const result = await client.getLatestLedger();
      return result.sequence;
    },

    async getOldestRetainedLedger() {
      // The oldest retained ledger is the RPC's minimum ledger sequence.
      // For Soroban RPC, this is typically available via getLatestLedger response,
      // or we can make a getEvents call with startLedger = 0 to discover it.
      // For now, assuming the RPC retains a reasonable window and starting from
      // getLatestLedger() - a safe default. This should be made configurable.
      const latest = await client.getLatestLedger();
      // Assume 24 hours of retention at ~6 sec/ledger = ~14400 ledgers
      return Math.max(1, latest.sequence - 14400);
    },

    async fetchEvents({ contractId, startLedger }): Promise<FetchEventsResult> {
      const response = await client.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds: [contractId] }],
      });

      const events: RawContractEvent[] = response.events.map((event) => ({
        contractId: event.contractId?.contractId() ?? contractId,
        rpcEventId: event.id,
        ledgerSeq: event.ledger,
        txHash: event.txHash,
        topic: event.topic.map((segment) => stringifyTopicSegment(scValToNative(segment))),
        value: scValToNative(event.value),
        closedAt: new Date(event.ledgerClosedAt),
      }));

      return { events, latestLedgerSeen: response.latestLedger };
    },
  };
}

/** Topics are always stored as `string[]` (Prisma schema) for simple
 * filtering/indexing later — most FaniLab event topics are already Symbols
 * (native string), but a non-string topic segment is stringified rather
 * than dropped. */
function stringifyTopicSegment(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
