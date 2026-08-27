import type { PrismaClient } from '@prisma/client';
import type { UserReader } from '../domain/index.js';

export function createPrismaUserReader(prisma: PrismaClient): UserReader {
  return {
    async findById(id) {
      return prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true, emailVerifiedAt: true, createdAt: true },
      });
    },
  };
}
