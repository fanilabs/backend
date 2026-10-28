import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../domain/clock.js';

const LEDGER_CACHE_TTL_MS = 5_000;

export function createLedgerClock(prisma: PrismaClient): Clock {
  let cachedLedgerClosedAt: Date | null = null;
  let cachedAt = 0;

  return {
    async now(): Promise<Date> {
      const currentTime = Date.now();
      if (cachedLedgerClosedAt !== null && currentTime - cachedAt < LEDGER_CACHE_TTL_MS) {
        return cachedLedgerClosedAt;
      }

      const latest = await prisma.blockchainEvent.findFirst({
        orderBy: { ledgerClosedAt: 'desc' },
        select: { ledgerClosedAt: true },
      });

      const ledgerClosedAt = latest?.ledgerClosedAt ?? new Date();
      cachedLedgerClosedAt = ledgerClosedAt;
      cachedAt = currentTime;

      return ledgerClosedAt;
    },
  };
}
