import type { Prisma, RefreshToken as PrismaRefreshToken } from '@prisma/client';
import type { RefreshTokenRecord, RefreshTokenRepository } from '../domain/index.js';

function toDomain(record: PrismaRefreshToken): RefreshTokenRecord {
  return {
    id: record.id,
    familyId: record.familyId,
    userId: record.userId,
    tokenHash: record.tokenHash,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

export function createPrismaRefreshTokenRepository(
  prisma: Prisma.TransactionClient,
): RefreshTokenRepository {
  return {
    async create(input) {
      const record = await prisma.refreshToken.create({
        data: {
          user: { connect: { id: input.userId } },
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          family: input.familyId
            ? { connect: { id: input.familyId } }
            : { create: { userId: input.userId } },
        },
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
    async isFamilyActive(familyId) {
      const family = await prisma.sessionFamily.findUnique({ where: { id: familyId } });
      return family !== null && family.revokedAt === null;
    },
    async revokeFamily(familyId) {
      await prisma.sessionFamily.update({
        where: { id: familyId },
        data: { revokedAt: new Date() },
      });
      await prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    async revokeAllForUser(userId) {
      await prisma.sessionFamily.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}
