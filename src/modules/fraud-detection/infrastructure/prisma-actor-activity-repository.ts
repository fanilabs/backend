import type { PrismaClient } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/actor-activity-repository';

export function createPrismaActorActivityRepository(
  prisma: PrismaClient,
): ActorActivityRepository {
  return {
    async deleteOlderThan(olderThan, batchSize, maxIterations = 50) {
      let totalDeleted = 0;
      let iterations = 0;

      for (;;) {
        if (iterations >= maxIterations) break;
        iterations += 1;

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
