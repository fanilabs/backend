import { PrismaClient } from '@prisma/client';
import type { BlockchainEvent } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLedgerClock } from './ledger-clock.js';

function eventAt(ledgerClosedAt: Date): BlockchainEvent {
  return {
    id: 'fixture',
    contractName: 'delivery',
    network: 'testnet',
    rpcEventId: 'event',
    ledgerSeq: 1n,
    txHash: 'hash',
    topic: [],
    payload: [],
    ledgerClosedAt,
    ingestedAt: ledgerClosedAt,
    processedAt: null,
  };
}

describe('createLedgerClock', () => {
  const prisma = new PrismaClient();
  const findFirst = vi.spyOn(prisma.blockchainEvent, 'findFirst');
  beforeEach(() => findFirst.mockReset());
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it('caches the latest ledger time across repeated now() calls', async () => {
    const ledgerClosedAt = new Date('2024-01-01T00:00:00.000Z');
    findFirst.mockResolvedValue(eventAt(ledgerClosedAt));
    const clock = createLedgerClock(prisma);
    for (let i = 0; i < 10; i += 1) {
      await expect(clock.now()).resolves.toEqual(ledgerClosedAt);
    }
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after the 5 second TTL elapses', async () => {
    vi.useFakeTimers();
    const firstLedgerClosedAt = new Date('2024-01-01T00:00:00.000Z');
    const secondLedgerClosedAt = new Date('2024-01-01T00:00:10.000Z');
    findFirst
      .mockResolvedValueOnce(eventAt(firstLedgerClosedAt))
      .mockResolvedValueOnce(eventAt(secondLedgerClosedAt));
    const clock = createLedgerClock(prisma);
    await expect(clock.now()).resolves.toEqual(firstLedgerClosedAt);
    expect(findFirst).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    await expect(clock.now()).resolves.toEqual(secondLedgerClosedAt);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('falls back to the current time when no blockchain event exists', async () => {
    findFirst.mockResolvedValue(null);
    const clock = createLedgerClock(prisma);
    const before = Date.now();
    const result = await clock.now();
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
