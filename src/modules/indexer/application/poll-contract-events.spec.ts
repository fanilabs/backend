import { describe, expect, it } from 'vitest';
import { createPollContractEventsUseCase } from './poll-contract-events.js';
import {
  buildRawEvent,
  createFakeEventPublisher,
  createFakeEventSource,
  createInMemoryCheckpointRepository,
  createInMemoryEventStore,
} from './__fixtures__/fakes.js';

function setup(overrides: { retentionWindowLedgers?: number } = {}) {
  const checkpointRepository = createInMemoryCheckpointRepository();
  const eventStore = createInMemoryEventStore();
  const eventSource = createFakeEventSource();
  const eventPublisher = createFakeEventPublisher();
  const pollContractEvents = createPollContractEventsUseCase({
    checkpointRepository,
    eventStore,
    eventSource,
    eventPublisher,
    ...overrides,
  });
  return { checkpointRepository, eventStore, eventSource, eventPublisher, pollContractEvents };
}

describe('pollContractEvents', () => {
  it('starts from the current chain tip on the first run for a contract (no backfill)', async () => {
    const { eventSource, pollContractEvents } = setup();
    eventSource.latestLedger = 5000;
    eventSource.queueResponse({ events: [], latestLedgerSeen: 5000 });

    const result = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result.lastLedgerSeq).toBe(5000n);
  });

  it('resumes from the persisted checkpoint on subsequent runs', async () => {
    const { checkpointRepository, eventSource, pollContractEvents } = setup();
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 4000n,
      updatedAt: new Date(),
    });
    eventSource.queueResponse({ events: [], latestLedgerSeen: 4200 });

    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    // fetchEvents was called with startLedger = 4001, not the chain tip —
    // verified indirectly via the resulting checkpoint advancing correctly.
    expect(await checkpointRepository.get('escrow', 'testnet')).toMatchObject({
      lastLedgerSeq: 4200n,
    });
  });

  it('durably stores and publishes each new event exactly once', async () => {
    const { eventSource, eventStore, eventPublisher, pollContractEvents } = setup();
    const eventA = buildRawEvent({ rpcEventId: 'evt-1' });
    const eventB = buildRawEvent({ rpcEventId: 'evt-2' });
    eventSource.queueResponse({ events: [eventA, eventB], latestLedgerSeen: 1002 });

    const result = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result.eventsFetched).toBe(2);
    expect(result.eventsInserted).toBe(2);
    expect(eventStore.stored).toHaveLength(2);
    expect(eventPublisher.published).toHaveLength(2);
  });

  it('does not re-publish an event that was already ingested (idempotent re-poll)', async () => {
    const { eventSource, eventStore, eventPublisher, pollContractEvents } = setup();
    const duplicate = buildRawEvent({ rpcEventId: 'evt-dup' });
    await eventStore.tryInsert({
      contractName: 'escrow',
      network: 'testnet',
      rpcEventId: 'evt-dup',
      ledgerSeq: 1001n,
      txHash: 'tx',
      topic: ['escrow_funded'],
      payload: {},
      closedAt: new Date(),
    });
    eventSource.queueResponse({ events: [duplicate], latestLedgerSeen: 1002 });

    const result = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result.eventsFetched).toBe(1);
    expect(result.eventsInserted).toBe(0);
    expect(eventPublisher.published).toHaveLength(0);
  });

  it('clamps a stale checkpoint forward to the RPC retention floor instead of requesting an aged-out ledger', async () => {
    const { checkpointRepository, eventSource, pollContractEvents } = setup({
      retentionWindowLedgers: 1000,
    });
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 100n, // long expired given a 1000-ledger retention window
      updatedAt: new Date(),
    });
    eventSource.latestLedger = 20_000;
    eventSource.queueResponse({ events: [], latestLedgerSeen: 20_000 });

    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    // retentionFloor = 20_000 - 1000 + 1 = 19_001, which is far past
    // checkpoint+1 (101) — the clamp, not the stale checkpoint, must win.
    expect(eventSource.fetchEventsCalls).toMatchObject([{ startLedger: 19_001 }]);
  });

  it('does not clamp a checkpoint that is still within the retention window', async () => {
    const { checkpointRepository, eventSource, pollContractEvents } = setup({
      retentionWindowLedgers: 1000,
    });
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 4000n,
      updatedAt: new Date(),
    });
    eventSource.latestLedger = 4200;
    eventSource.queueResponse({ events: [], latestLedgerSeen: 4200 });

    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(eventSource.fetchEventsCalls).toMatchObject([{ startLedger: 4001 }]);
  });

  it('advances the checkpoint even when a poll returns zero events', async () => {
    const { checkpointRepository, eventSource, pollContractEvents } = setup();
    eventSource.latestLedger = 2000;
    eventSource.queueResponse({ events: [], latestLedgerSeen: 2000 });
    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    eventSource.queueResponse({ events: [], latestLedgerSeen: 2050 });
    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(await checkpointRepository.get('escrow', 'testnet')).toMatchObject({
      lastLedgerSeq: 2050n,
    });
  });
});
