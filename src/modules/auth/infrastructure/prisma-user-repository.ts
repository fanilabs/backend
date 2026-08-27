import type { PrismaClient, User as PrismaUser } from '@prisma/client';
import type { User, UserRepository } from '../domain/index.js';

function toDomain(record: PrismaUser): User {
  return {
    id: record.id,
    email: record.email,
    passwordHash: record.passwordHash,
    role: record.role,
    emailVerifiedAt: record.emailVerifiedAt,
    createdAt: record.createdAt,
  };
}

/**
 * Real UserRepository implementation of the `auth` domain port, backed by
 * Prisma. Takes a `PrismaClient` instance rather than reaching for the
 * shared singleton itself, so tests can inject a different client (a real
 * test-database client per docs/DATABASE.md's "no mocking the repository
 * layer" rule) without this module knowing or caring.
 */
export function createPrismaUserRepository(prisma: PrismaClient): UserRepository {
  return {
    async findByEmail(email) {
      const record = await prisma.user.findUnique({ where: { email } });
      return record ? toDomain(record) : null;
    },
    async findById(id) {
      const record = await prisma.user.findUnique({ where: { id } });
      return record ? toDomain(record) : null;
    },
    async create(input) {
      const record = await prisma.user.create({
        data: { email: input.email, passwordHash: input.passwordHash, role: input.role },
      });
      return toDomain(record);
    },
    async markEmailVerified(id) {
      await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    },
    async updatePasswordHash(id, passwordHash) {
      await prisma.user.update({ where: { id }, data: { passwordHash } });
    },
  };
}
