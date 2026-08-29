import type { PrismaClient } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/index.js';

export function createPrismaActorActivityRepository(prisma: PrismaClient): ActorActivityRepository {
  return {
    async record(input) {
      await prisma.actorActivity.create({
        data: { address: input.address, category: input.category, occurredAt: input.occurredAt },
      });
    },

    async countSince(address, category, since) {
      return prisma.actorActivity.count({
        where: { address, category, occurredAt: { gte: since } },
      });
    },

    async deleteOlderThan(olderThan, batchSize) {
      let totalDeleted = 0;
      // Prisma has no "DELETE ... LIMIT" — select a batch of ids, then
      // delete exactly those, looping until a batch comes back short (the
      // table is exhausted) rather than issuing one unbounded DELETE that
      // could hold a long lock over the whole matching range.
      for (;;) {
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
