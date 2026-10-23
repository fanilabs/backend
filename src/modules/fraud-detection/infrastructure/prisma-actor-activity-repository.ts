import type { PrismaClient, ActorActivityCategory } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/ports.js';

const DEFAULT_DELETE_BATCH_SIZE = 1_000;
const DEFAULT_MAX_DELETE_ITERATIONS = 50;

export function createPrismaActorActivityRepository(prisma: PrismaClient): ActorActivityRepository {
  return {
    async record(input) {
      await prisma.actorActivity.create({
        data: {
          address: input.address,
          category: input.category,
          occurredAt: input.occurredAt,
        },
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
      batchSize: number = DEFAULT_DELETE_BATCH_SIZE,
      maxIterations: number = DEFAULT_MAX_DELETE_ITERATIONS,
    ): Promise<number> {
      let totalDeleted = 0;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const batch = await prisma.actorActivity.findMany({
          where: { occurredAt: { lt: olderThan } },
          select: { id: true },
          take: batchSize,
        });
        if (batch.length === 0) break;

        const { count } = await prisma.actorActivity.deleteMany({
          where: { id: { in: batch.map((row) => row.id) } },
        });
        totalDeleted += count;

        if (batch.length < batchSize) break;
      }
      return totalDeleted;
    },
  };
}
