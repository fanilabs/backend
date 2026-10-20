import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../domain/index.js';

export const DEFAULT_LEDGER_CLOCK_TTL_MS = 5_000;

/**
 * Derives "now" from the most recently ingested blockchain event's ledger
 * close time with a 5-second in-memory cache (#404) so repeated rule
 * evaluations inside `assessActor` do not re-query PostgreSQL on every rule.
 */
export function createLedgerClock(
  prisma: PrismaClient,
  ttlMs: number = DEFAULT_LEDGER_CLOCK_TTL_MS,
): Clock {
  let cachedValue: Date | null = null;
  let expiresAt = 0;

  return {
    async now(): Promise<Date> {
      const currentWallMs = Date.now();
      if (cachedValue !== null && currentWallMs < expiresAt) {
        return cachedValue;
      }

      const latest = await prisma.blockchainEvent.findFirst({
        orderBy: { ledgerClosedAt: 'desc' },
        select: { ledgerClosedAt: true },
      });
      const resolved = latest?.ledgerClosedAt ?? new Date();
      if (ttlMs > 0) {
        cachedValue = resolved;
        expiresAt = currentWallMs + ttlMs;
      }
      return resolved;
    },
  };
}
