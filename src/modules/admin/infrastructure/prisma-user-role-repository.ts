import type { Prisma } from '@prisma/client';
import type { UserRoleRepository } from '../domain/index.js';

/** Takes a `Prisma.TransactionClient` (or the root `PrismaClient`, which
 * structurally satisfies it) so the same adapter can be built on the root
 * client for standalone reads and on an interactive-transaction client
 * inside `AdminUnitOfWork` (#276). */
export function createPrismaUserRoleRepository(
  prisma: Prisma.TransactionClient,
): UserRoleRepository {
  return {
    async findById(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true },
      });
      return user;
    },

    async updateRole(userId, role) {
      await prisma.user.update({ where: { id: userId }, data: { role } });
    },

    async countByRole(role) {
      return prisma.user.count({ where: { role } });
    },
  };
}
