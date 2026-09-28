import type { SorobanClient } from '../../../blockchain/soroban-client.js';
import { scValToNative } from '../../../blockchain/xdr/sc-val.js';
import { BlockchainError } from '../../../shared/errors/index.js';
import type { EventSource, FetchEventsResult, RawContractEvent } from '../domain/index.js';

const VALID_RANGE_ERROR = /startLedger must be within the ledger range:\s*(\d+)\s*-\s*(\d+)/;

/**
 * Real EventSource implementation of the indexer domain port, backed by the
 * shared resilient Soroban RPC client (retry + circuit breaker already
 * built in — this file adds no retry logic of its own for network-level
 * failures). Decodes each raw RPC event's topic/value XDR into native
 * values via scValToNative so nothing downstream ever touches xdr.ScVal
 * directly.
 */
export function createSorobanEventSource(client: SorobanClient): EventSource {
  return {
    async getLatestLedger() {
      const result = await client.getLatestLedger();
      return result.sequence;
    },

    async fetchEvents({ contractId, startLedger }): Promise<FetchEventsResult> {
      try {
        return await runGetEvents(client, contractId, startLedger);
      } catch (error) {
        // The caller already clamps startLedger against its own estimate of
        // the RPC's retention window, but that estimate can still be wrong
        // (a shorter-than-expected retention window, or the requested
        // ledger not yet indexed at the bleeding edge). When the RPC itself
        // rejects the range with -32600, it reports the exact valid window
        // in its error message — retry once against that authoritative
        // range instead of failing the whole poll cycle.
        const validRangeStart = parseValidRangeStart(error);
        if (validRangeStart === undefined) throw error;
        return runGetEvents(client, contractId, validRangeStart);
      }
    },
  };
}

async function runGetEvents(
  client: SorobanClient,
  contractId: string,
  startLedger: number,
): Promise<FetchEventsResult> {
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
}

function parseValidRangeStart(error: unknown): number | undefined {
  if (!(error instanceof BlockchainError)) return undefined;
  const cause = (error.details as { cause?: string } | undefined)?.cause;
  const match = cause ? VALID_RANGE_ERROR.exec(cause) : null;
  return match ? Number(match[1]) : undefined;
}

/** Topics are always stored as `string[]` (Prisma schema) for simple
 * filtering/indexing later — most FaniLab event topics are already Symbols
 * (native string), but a non-string topic segment is stringified rather
 * than dropped. */
function stringifyTopicSegment(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
