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
  getCallCount(): number;
} {
  const checkpoints = new Map<string, Checkpoint>();
  const key = (contractName: string, network: string): string => `${contractName}:${network}`;
  let getCallCount = 0;

  return {
    seed(checkpoint) {
      checkpoints.set(key(checkpoint.contractName, checkpoint.network), checkpoint);
    },
    getCallCount() {
      return getCallCount;
    },
    async get(contractName, network) {
      getCallCount++;
      return checkpoints.get(key(contractName, network)) ?? null;
    },
    async getMany(contractNames, network) {
      getCallCount += 1;
      return contractNames.map((contractName) => checkpoints.get(key(contractName, network)) ?? null);
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

export function createInMemoryEventStore(): EventStore & {
  stored: StoredEvent[];
  processed: Set<string>;
  failed: Map<string, string>;
} {
  const stored: StoredEvent[] = [];
  const seen = new Set<string>();
  const processed = new Set<string>();
  const failed = new Map<string, string>();
  const key = (event: StoredEvent): string =>
    `${event.contractName}:${event.network}:${event.rpcEventId}`;

  return {
    stored,
    processed,
    failed,
    async tryInsert(event) {
      const k = key(event);
      if (seen.has(k)) return false;
      seen.add(k);
      stored.push(event);
      return true;
    },
    async markProcessed(rpcEventId) {
      processed.add(rpcEventId);
      failed.delete(rpcEventId);
    },
    async markFailed(rpcEventId, reason) {
      failed.set(rpcEventId, reason);
      processed.delete(rpcEventId);
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
  getLatestLedgerCallCount(): number;
} {
  const responses: FetchEventsResult[] = [];
  let latestLedger = 1000;
  let getLatestLedgerCalls = 0;

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
    getLatestLedgerCallCount() {
      return getLatestLedgerCalls;
    },
    async getLatestLedger() {
      getLatestLedgerCalls++;
      return latestLedger;
    },
    async getOldestRetainedLedger() {
      return oldestRetainedLedger;
    },
    setOldestRetainedLedger(value: number) {
      oldestRetainedLedger = value;
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
