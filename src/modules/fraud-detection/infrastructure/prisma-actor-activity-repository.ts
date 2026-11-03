import type { PrismaClient, ActorActivityCategory } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/ports.js';

export function createPrismaActorActivityRepository(prisma: PrismaClient): ActorActivityRepository {
  return {
    async record(input) {
      await prisma.actorActivity.create({
        data: { address: input.address, category: input.category, occurredAt: input.occurredAt },
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

    async deleteOlderThan(cutoff: Date): Promise<number> {
      const result = await prisma.actorActivity.deleteMany({
        where: { occurredAt: { lt: cutoff } },
      });
      return result.count;
    },
  };
}
