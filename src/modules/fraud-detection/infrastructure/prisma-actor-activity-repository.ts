import type { PrismaClient, ActorActivity, ActorActivityCategory } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/ports.js';

/** Default upper bound on batch loop iterations per cleanup invocation to prevent
 * BullMQ worker lock expiry during large backlog cleanups (issue #469). */
export const DEFAULT_CLEANUP_MAX_ITERATIONS = 50;

export function createPrismaActorActivityRepository(prisma: PrismaClient): ActorActivityRepository {
  return {
    async record(activity: ActorActivity): Promise<ActorActivity> {
      return prisma.actorActivity.create({ data: activity });
    },

    async findByAddress(
      address: string,
      category?: ActorActivityCategory,
      since?: Date,
    ): Promise<ActorActivity[]> {
      return prisma.actorActivity.findMany({
        where: {
          address,
          ...(category ? { category } : {}),
          ...(since ? { occurredAt: { gte: since } } : {}),
        },
        orderBy: { occurredAt: 'desc' },
      });
    },

    async countSince(
      address: string,
      category: ActorActivityCategory,
      since: Date,
      limit?: number,
    ): Promise<number> {
      const where = { address, category, occurredAt: { gte: since } };

      if (limit === undefined) {
        return prisma.actorActivity.count({ where });
      }

      const rows = await prisma.actorActivity.findMany({
        where,
        take: limit,
        select: { id: true },
      });
      return rows.length;
    },

    async deleteOlderThan(
      olderThan: Date,
      batchSize?: number,
      maxIterations: number = DEFAULT_CLEANUP_MAX_ITERATIONS,
    ): Promise<number> {
      if (batchSize === undefined) {
        const result = await prisma.actorActivity.deleteMany({
          where: { occurredAt: { lt: olderThan } },
        });
        return result.count;
      }

      let totalDeleted = 0;
      let iterations = 0;

      while (iterations < maxIterations) {
        iterations++;
        const batch = await prisma.actorActivity.findMany({
          where: { occurredAt: { lt: olderThan } },
          select: { id: true },
          take: batchSize,
        });

        if (batch.length === 0) {
          break;
        }

        const { count } = await prisma.actorActivity.deleteMany({
          where: { id: { in: batch.map((row) => row.id) } },
        });
        totalDeleted += count;

        if (batch.length < batchSize) {
          break;
        }
      }

      return totalDeleted;
    },
  };
}
