import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  onBlockchainEvent,
  publishBlockchainEvent,
  type BlockchainEventEnvelope,
} from './index.js';

function buildEvent(overrides: Partial<BlockchainEventEnvelope> = {}): BlockchainEventEnvelope {
  return {
    contractName: 'escrow',
    network: 'testnet',
    rpcEventId: 'evt-1',
    ledgerSeq: 1n,
    txHash: 'abc',
    topic: ['something_happened'],
    payload: ['1'],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Direct coverage of the in-process bus's own contract, independent of any
 * module handler — every module's real-time correctness rides on this seam
 * (`onBlockchainEvent` / `publishBlockchainEvent`), yet all other tests
 * exercise their handler function directly rather than going through the bus.
 */
describe('blockchain event bus', () => {
  const cleanup: Array<() => void> = [];

  function subscribe(handler: (event: BlockchainEventEnvelope) => void) {
    const off = onBlockchainEvent(handler);
    cleanup.push(off);
    return off;
  }

  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.();
  });

  it('delivers a published event to every current subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribe(first);
    subscribe(second);

    const event = buildEvent();
    publishBlockchainEvent(event);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(event);
  });

  it('stops delivering to a listener once its unsubscribe function is called, without affecting others', () => {
    const stays = vi.fn();
    const leaves = vi.fn();
    subscribe(stays);
    const off = subscribe(leaves);

    publishBlockchainEvent(buildEvent({ rpcEventId: 'first' }));
    off();
    publishBlockchainEvent(buildEvent({ rpcEventId: 'second' }));

    expect(leaves).toHaveBeenCalledTimes(1);
    expect(leaves.mock.calls[0]?.[0]).toMatchObject({ rpcEventId: 'first' });
    expect(stays).toHaveBeenCalledTimes(2);
  });

  it('is a no-op — not an error — when publishing with zero subscribers', () => {
    expect(() => publishBlockchainEvent(buildEvent())).not.toThrow();
  });

  it('delivers each publish call independently rather than batching or coalescing them', () => {
    const handler = vi.fn();
    subscribe(handler);

    publishBlockchainEvent(buildEvent({ rpcEventId: 'a' }));
    publishBlockchainEvent(buildEvent({ rpcEventId: 'b' }));
    publishBlockchainEvent(buildEvent({ rpcEventId: 'c' }));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls.map(([event]) => event.rpcEventId)).toEqual(['a', 'b', 'c']);
  });

  it('tolerates its unsubscribe function being called more than once', () => {
    const handler = vi.fn();
    const off = onBlockchainEvent(handler);

    off();
    expect(() => off()).not.toThrow();

    publishBlockchainEvent(buildEvent());
    expect(handler).not.toHaveBeenCalled();
  });
});
