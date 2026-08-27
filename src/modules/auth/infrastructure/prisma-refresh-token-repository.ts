import type { PrismaClient, RefreshToken as PrismaRefreshToken } from '@prisma/client';
import type { RefreshTokenRecord, RefreshTokenRepository } from '../domain/index.js';

function toDomain(record: PrismaRefreshToken): RefreshTokenRecord {
  return {
    id: record.id,
    userId: record.userId,
    tokenHash: record.tokenHash,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

export function createPrismaRefreshTokenRepository(prisma: PrismaClient): RefreshTokenRepository {
  return {
    async create(input) {
      const record = await prisma.refreshToken.create({
        data: { userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt },
      });
      return toDomain(record);
    },
    async findByTokenHash(tokenHash) {
      const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      return record ? toDomain(record) : null;
    },
    async revoke(id) {
      await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
    },
    async revokeAllForUser(userId) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}
