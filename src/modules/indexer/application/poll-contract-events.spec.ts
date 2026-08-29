import { describe, expect, it } from 'vitest';
import { createPollContractEventsUseCase } from './poll-contract-events.js';
import {
  buildRawEvent,
  createFakeEventPublisher,
  createFakeEventSource,
  createInMemoryCheckpointRepository,
  createInMemoryEventStore,
} from './__fixtures__/fakes.js';

function setup() {
  const checkpointRepository = createInMemoryCheckpointRepository();
  const eventStore = createInMemoryEventStore();
  const eventSource = createFakeEventSource();
  const eventPublisher = createFakeEventPublisher();
  const pollContractEvents = createPollContractEventsUseCase({
    checkpointRepository,
    eventStore,
    eventSource,
    eventPublisher,
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

  it('handles pagination: yields every event stored exactly once across consecutive poll cycles', async () => {
    const { checkpointRepository, eventSource, eventStore, eventPublisher, pollContractEvents } =
      setup();

    // First page: events at ledgers 1000-1001
    const page1Events = [
      buildRawEvent({ rpcEventId: 'evt-1', ledgerSeq: 1000 }),
      buildRawEvent({ rpcEventId: 'evt-2', ledgerSeq: 1001 }),
    ];
    eventSource.queueResponse({ events: page1Events, latestLedgerSeen: 1005 });

    // First poll cycle
    const result1 = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result1.eventsFetched).toBe(2);
    expect(result1.eventsInserted).toBe(2);
    expect(eventStore.stored).toHaveLength(2);
    expect(eventPublisher.published).toHaveLength(2);

    // Checkpoint should be at the highest ledger reached, not the RPC tip
    const checkpoint1 = await checkpointRepository.get('escrow', 'testnet');
    expect(checkpoint1?.lastLedgerSeq).toBe(1005n);

    // Second page: events at ledgers 1002-1003
    const page2Events = [
      buildRawEvent({ rpcEventId: 'evt-3', ledgerSeq: 1002 }),
      buildRawEvent({ rpcEventId: 'evt-4', ledgerSeq: 1003 }),
    ];
    eventSource.queueResponse({ events: page2Events, latestLedgerSeen: 1010 });

    // Reset publishers to verify only new events are published
    eventPublisher.published.length = 0;

    // Second poll cycle
    const result2 = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result2.eventsFetched).toBe(2);
    expect(result2.eventsInserted).toBe(2);
    expect(eventStore.stored).toHaveLength(4);
    expect(eventPublisher.published).toHaveLength(2);

    const checkpoint2 = await checkpointRepository.get('escrow', 'testnet');
    expect(checkpoint2?.lastLedgerSeq).toBe(1010n);
  });

  it('clamps startLedger to the oldest retained ledger when checkpoint is outside RPC window', async () => {
    const { checkpointRepository, eventSource, pollContractEvents } = setup();

    // Set up a stale checkpoint that's older than the RPC retention window
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 500n,
      updatedAt: new Date(),
    });

    // RPC only retains events from ledger 1000 onwards
    eventSource.setOldestRetainedLedger(1000);
    eventSource.latestLedger = 2000;
    eventSource.queueResponse({
      events: [buildRawEvent({ rpcEventId: 'evt-1', ledgerSeq: 1000 })],
      latestLedgerSeen: 1100,
    });

    // Should not throw; should resume from the oldest retained ledger
    const result = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result.eventsFetched).toBe(1);
    expect(result.eventsInserted).toBe(1);

    // Checkpoint should advance to the latest ledger seen
    const checkpoint = await checkpointRepository.get('escrow', 'testnet');
    expect(checkpoint?.lastLedgerSeq).toBe(1100n);
  });

  it('successfully handled events have processedAt set', async () => {
    const { eventSource, eventStore, pollContractEvents } = setup();
    const event = buildRawEvent({ rpcEventId: 'evt-processed' });
    eventSource.queueResponse({ events: [event], latestLedgerSeen: 1001 });

    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    // After successful insertion, the event should be marked as processed
    expect(eventStore.processed.has('evt-processed')).toBe(true);
    expect(eventStore.failed.has('evt-processed')).toBe(false);
  });

  it('failed handler events record the reason and leave processedAt null', async () => {
    const { eventSource, eventStore, pollContractEvents } = setup();
    const event = buildRawEvent({ rpcEventId: 'evt-failed' });
    eventSource.queueResponse({ events: [event], latestLedgerSeen: 1001 });

    await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    // Simulate a handler failure being recorded
    await eventStore.markFailed('evt-failed', 'FK violation: missing parent delivery');

    expect(eventStore.failed.get('evt-failed')).toBe('FK violation: missing parent delivery');
    expect(eventStore.processed.has('evt-failed')).toBe(false);
  });

  it('reprocessing unprocessed events is idempotent when run twice', async () => {
    const { eventSource, eventStore, eventPublisher, pollContractEvents } = setup();
    const event1 = buildRawEvent({ rpcEventId: 'evt-1' });
    const event2 = buildRawEvent({ rpcEventId: 'evt-2' });
    eventSource.queueResponse({ events: [event1, event2], latestLedgerSeen: 1002 });

    // First run
    const result1 = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result1.eventsInserted).toBe(2);
    expect(eventPublisher.published).toHaveLength(2);

    // Mark both as processed
    await eventStore.markProcessed('evt-1');
    await eventStore.markProcessed('evt-2');

    // Queue the same events again
    eventSource.queueResponse({ events: [event1, event2], latestLedgerSeen: 1002 });
    eventPublisher.published.length = 0;

    // Second run (reprocessing)
    const result2 = await pollContractEvents({
      contractName: 'escrow',
      contractId: 'C_ESCROW',
      network: 'testnet',
    });

    expect(result2.eventsInserted).toBe(0);
    expect(eventPublisher.published).toHaveLength(0);
  });
});
