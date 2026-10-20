import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createLedgerClock } from './ledger-clock.js';

describe('createLedgerClock (#404)', () => {
  it('caches the latest ledgerClosedAt timestamp within the 5-second TTL window', async () => {
    const ledgerTime = new Date('2026-10-20T12:00:00Z');
    const findFirst = vi.fn().mockResolvedValue({ ledgerClosedAt: ledgerTime });
    const fakePrisma = {
      blockchainEvent: { findFirst },
    } as unknown as PrismaClient;

    const clock = createLedgerClock(fakePrisma, 5_000);
    for (let i = 0; i < 10; i += 1) {
      const result = await clock.now();
      expect(result).toEqual(ledgerTime);
    }

    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
