import { describe, it, expect, vi } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { SorobanEventSource } from './soroban-event-source';

function topicSymbol(value: string): string {
  return nativeToScVal(value, { type: 'symbol' }).toXDR('base64');
}

function topicTuple(values: string[]): string {
  const scVal = xdr.ScVal.scvVec(
    values.map((v) => nativeToScVal(v, { type: 'symbol' })),
  );
  return scVal.toXDR('base64');
}

function valueU32(value: number): string {
  return nativeToScVal(value, { type: 'u32' }).toXDR('base64');
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '0000000001-0000000001',
    type: 'contract',
    ledger: 42,
    ledgerClosedAt: '2024-01-01T00:00:00Z',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    txHash: 'abc123hash',
    topic: [topicSymbol('transfer'), topicTuple(['a', 'b'])],
    value: valueU32(7),
    ...overrides,
  };
}

function makeClient(events: unknown[], latestLedger = 100) {
  return {
    getEvents: vi.fn().mockResolvedValue({ events, latestLedger }),
  };
}

describe('SorobanEventSource nonempty event decoding', () => {
  it('decodes a complete RawContractEvent preserving identity, contract, ledger and payload', async () => {
    const client = makeClient([makeEvent()]);
    const source = new SorobanEventSource(client as never);

    const result = await source.fetchEvents({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      startLedger: 1,
    });

    expect(result.events).toHaveLength(1);
    const event = result.events[0];

    expect(event.id).toBe('0000000001-0000000001');
    expect(event.contractId).toBe(
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    );
    expect(event.ledger).toBe(42);
    expect(event.ledgerClosedAt).toBe('2024-01-01T00:00:00Z');
    expect(event.txHash).toBe('abc123hash');
    expect(result.latestLedgerSeen).toBe(100);

    expect(event.topics[0]).toBe('transfer');
    expect(event.topics[1]).toBe(JSON.stringify(['a', 'b']));
    expect(event.value).toBe(7);
  });

  it('falls back to the requested contract ID when the response omits contractId', async () => {
    const requested = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const client = makeClient([makeEvent({ contractId: undefined })]);
    const source = new SorobanEventSource(client as never);

    const result = await source.fetchEvents({
      contractId: requested,
      startLedger: 1,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].contractId).toBe(requested);
  });

  it('keeps symbol topics as strings and tuple topics as JSON', async () => {
    const client = makeClient([
      makeEvent({
        topic: [topicSymbol('mint'), topicTuple(['x', 'y', 'z'])],
      }),
    ]);
    const source = new SorobanEventSource(client as never);

    const result = await source.fetchEvents({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      startLedger: 1,
    });

    const event = result.events[0];
    expect(typeof event.topics[0]).toBe('string');
    expect(event.topics[0]).toBe('mint');
    expect(event.topics[1]).toBe(JSON.stringify(['x', 'y', 'z']));
  });
});
