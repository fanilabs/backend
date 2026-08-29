import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../domain/index.js';

/**
 * Derives "now" from the most recently ingested blockchain event's ledger
 * close time, rather than wall-clock time — see `../domain/clock.ts`'s
 * header comment. This keeps `assessActor`'s window boundary on the same
 * time base as `ActorActivity.occurredAt` (also ledger close time, see
 * `record-actor-activity-from-event.ts`), so rule windows are correct
 * regardless of how far behind the indexer currently is: a lagging
 * indexer simply makes "now" lag too, in lockstep with the data it's
 * being compared against, instead of racing ahead of it.
 *
 * Falls back to real wall-clock time when no event has been ingested yet
 * (e.g. a freshly seeded database) — there is no ledger time to derive
 * from in that case, and refusing to assess would be worse than a
 * momentarily-approximate window.
 */
export function createLedgerClock(prisma: PrismaClient): Clock {
  return {
    async now(): Promise<Date> {
      const latest = await prisma.blockchainEvent.findFirst({
        orderBy: { ledgerClosedAt: 'desc' },
        select: { ledgerClosedAt: true },
      });
      return latest?.ledgerClosedAt ?? new Date();
    },
  };
}
