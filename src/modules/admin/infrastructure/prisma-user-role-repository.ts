import type { PrismaClient } from '@prisma/client';
import type { UserRoleRepository } from '../domain/index.js';

export function createPrismaUserRoleRepository(prisma: PrismaClient): UserRoleRepository {
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
