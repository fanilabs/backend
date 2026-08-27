import type {
  Checkpoint,
  CheckpointRepository,
  EventPublisher,
  EventSource,
  EventStore,
  FetchEventsResult,
  RawContractEvent,
  StoredEvent,
} from '../../domain/index.js';

export function createInMemoryCheckpointRepository(): CheckpointRepository & {
  seed(checkpoint: Checkpoint): void;
} {
  const checkpoints = new Map<string, Checkpoint>();
  const key = (contractName: string, network: string): string => `${contractName}:${network}`;

  return {
    seed(checkpoint) {
      checkpoints.set(key(checkpoint.contractName, checkpoint.network), checkpoint);
    },
    async get(contractName, network) {
      return checkpoints.get(key(contractName, network)) ?? null;
    },
    async advance(contractName, network, lastLedgerSeq) {
      checkpoints.set(key(contractName, network), {
        contractName,
        network,
        lastLedgerSeq,
        updatedAt: new Date(),
      });
    },
  };
}

export function createInMemoryEventStore(): EventStore & { stored: StoredEvent[] } {
  const stored: StoredEvent[] = [];
  const seen = new Set<string>();
  const key = (event: StoredEvent): string =>
    `${event.contractName}:${event.network}:${event.rpcEventId}`;

  return {
    stored,
    async tryInsert(event) {
      const k = key(event);
      if (seen.has(k)) return false;
      seen.add(k);
      stored.push(event);
      return true;
    },
  };
}

export function createFakeEventPublisher(): EventPublisher & { published: StoredEvent[] } {
  const published: StoredEvent[] = [];
  return {
    published,
    publish(event) {
      published.push(event);
    },
  };
}

/** A scriptable fake EventSource — each call to `fetchEvents` returns the
 * next queued response, so tests can simulate multiple poll cycles. */
export function createFakeEventSource(): EventSource & {
  latestLedger: number;
  queueResponse(response: FetchEventsResult): void;
} {
  const responses: FetchEventsResult[] = [];
  let latestLedger = 1000;

  return {
    get latestLedger() {
      return latestLedger;
    },
    set latestLedger(value: number) {
      latestLedger = value;
    },
    queueResponse(response) {
      responses.push(response);
    },
    async getLatestLedger() {
      return latestLedger;
    },
    async fetchEvents(_input) {
      const next = responses.shift();
      return next ?? { events: [], latestLedgerSeen: latestLedger };
    },
  };
}

export function buildRawEvent(overrides: Partial<RawContractEvent> = {}): RawContractEvent {
  return {
    contractId: 'CONTRACT_ID',
    rpcEventId: `${Math.random()}`,
    ledgerSeq: 1001,
    txHash: 'tx-hash',
    topic: ['escrow_funded'],
    value: { amount: 100 },
    closedAt: new Date(),
    ...overrides,
  };
}
