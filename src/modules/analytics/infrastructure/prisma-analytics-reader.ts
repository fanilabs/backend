import type { PrismaClient } from '@prisma/client';
import { decimalToBigInt } from '../../../shared/database/index.js';
import type { AnalyticsReader } from '../domain/index.js';

/**
 * Reads `deliveries`/`escrows`/`disputes`/`driver_profiles` directly — see
 * `domain/ports.ts`'s `AnalyticsReader` header comment for why that's this
 * module's whole job, not a boundary violation the way it would be
 * elsewhere. Every query is a read-only `count`/`groupBy`.
 */
export function createPrismaAnalyticsReader(prisma: PrismaClient): AnalyticsReader {
  return {
    async getGmvByToken() {
      const grouped = await prisma.escrow.groupBy({
        by: ['token'],
        where: { status: 'RELEASED' },
        _sum: { amount: true },
        _count: { _all: true },
      });
      return grouped.map((row) => ({
        token: row.token,
        releasedAmount: row._sum.amount === null ? 0n : decimalToBigInt(row._sum.amount),
        releasedCount: row._count._all,
      }));
    },

    async getDeliveryFunnelCounts() {
      const [totalDeliveries, deliveredCount, disputedCount] = await Promise.all([
        prisma.delivery.count(),
        prisma.delivery.count({ where: { status: 'DELIVERED' } }),
        // One `disputes` row per `chainDeliveryId` — every delivery ever
        // disputed, not a snapshot of deliveries currently `DISPUTED`
        // (see get-dispute-rate.ts's header comment for why that would
        // undercount).
        prisma.dispute.count(),
      ]);
      return { totalDeliveries, deliveredCount, disputedCount };
    },

    async getDriverTierCounts() {
      const grouped = await prisma.driverProfile.groupBy({
        by: ['tier'],
        _count: { _all: true },
      });
      const counts = { bronze: 0, silver: 0, gold: 0 };
      for (const row of grouped) {
        if (row.tier === 'BRONZE') counts.bronze = row._count._all;
        else if (row.tier === 'SILVER') counts.silver = row._count._all;
        else if (row.tier === 'GOLD') counts.gold = row._count._all;
      }
      return counts;
    },
  };
}
