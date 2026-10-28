import { afterEach, describe, expect, it, vi } from 'vitest';
import { Contract, StrKey, xdr } from '@stellar/stellar-sdk';
import { SorobanClient } from '../src/blockchain/soroban-client.js';
import { createSorobanEventSource } from '../src/modules/indexer/infrastructure/soroban-event-source.js';
import { namedStructToScVal, addressToScVal, u64ToScVal } from '../src/blockchain/xdr/sc-val.js';
import { testAddress } from '../src/shared/testing/addresses.js';
import { createPollContractEventsUseCase } from '../src/modules/indexer/application/poll-contract-events.js';
import {
  buildRawEvent,
  createFakeEventSource,
  createInMemoryCheckpointRepository,
  createInMemoryEventStore,
  createFakeEventPublisher,
} from '../src/modules/indexer/application/__fixtures__/fakes.js';
const contractId = StrKey.encodeContract(Buffer.alloc(32, 5));
const responseEvent = () => ({
  id: 'event',
  type: 'contract' as const,
  ledger: 42,
  ledgerClosedAt: '2026-10-28T00:00:00Z',
  pagingToken: 'token',
  inSuccessfulContractCall: true,
  txHash: 'fixture',
  contractId: new Contract(contractId),
  topic: [xdr.ScVal.scvSymbol('delivery_created')],
  value: namedStructToScVal({
    delivery_id: u64ToScVal(7n),
    sender: addressToScVal(testAddress('sender')),
  }),
});
afterEach(() => vi.restoreAllMocks());
describe('observed source identity, not configuration-inferred origin', () => {
  it('uses the actual XDR decoder and retains reference named-event shape and observed origin', async () => {
    const client = new SorobanClient();
    vi.spyOn(client, 'getEvents').mockResolvedValue({
      latestLedger: 42,
      events: [responseEvent()],
    });
    const result = await createSorobanEventSource(client).fetchEvents({
      contractId,
      startLedger: 42,
    });
    expect(result.events[0]).toMatchObject({
      contractId,
      ledgerSeq: 42,
      value: { delivery_id: '7', sender: testAddress('sender') },
    });
  });
  it('rejects missing or different RPC contract identities rather than falling back to request configuration', async () => {
    const client = new SorobanClient();
    const { contractId: _ignored, ...unbound } = responseEvent();
    const rpc = vi.spyOn(client, 'getEvents');
    for (const event of [
      unbound,
      { ...responseEvent(), contractId: new Contract(StrKey.encodeContract(Buffer.alloc(32, 6))) },
    ]) {
      rpc.mockResolvedValue({ latestLedger: 42, events: [event] });
      await expect(
        createSorobanEventSource(client).fetchEvents({ contractId, startLedger: 42 }),
      ).rejects.toThrow('contract identity');
    }
  });
  it('the poll boundary rejects wrong-origin events before persistence, dispatch or checkpoint advancement', async () => {
    const source = createFakeEventSource();
    const store = createInMemoryEventStore();
    const checkpoint = createInMemoryCheckpointRepository();
    const publisher = createFakeEventPublisher();
    source.queueResponse({
      events: [buildRawEvent({ contractId: 'WRONG' })],
      latestLedgerSeen: 42,
    });
    const poll = createPollContractEventsUseCase({
      checkpointRepository: checkpoint,
      eventSource: source,
      eventStore: store,
      eventPublisher: publisher,
    });
    await expect(
      poll({ contractName: 'delivery', contractId, network: 'fixture' }),
    ).rejects.toThrow('contract identity');
    expect(store.stored).toEqual([]);
    expect(publisher.published).toEqual([]);
    expect(await checkpoint.get('delivery', 'fixture')).toBeNull();
  });
});
