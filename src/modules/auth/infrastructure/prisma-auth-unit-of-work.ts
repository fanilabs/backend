import type { PrismaClient } from '@prisma/client';
import type { AuthUnitOfWork } from '../domain/index.js';
import { createPrismaUserRepository } from './prisma-user-repository.js';
import { createPrismaRefreshTokenRepository } from './prisma-refresh-token-repository.js';

export function createPrismaAuthUnitOfWork(prisma: PrismaClient): AuthUnitOfWork {
  return {
    async run(userId, work) {
      return prisma.$transaction(async (tx) => {
        // One lock order for rotation/reset: user first, then family/token rows.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        return work({
          userRepository: createPrismaUserRepository(tx),
          refreshTokenRepository: createPrismaRefreshTokenRepository(tx),
        });
      });
    },
  };
}
