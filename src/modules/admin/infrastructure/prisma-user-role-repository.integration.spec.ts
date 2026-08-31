import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaUserRoleRepository } from './prisma-user-role-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma user role repository (integration)', () => {
  const prisma = new PrismaClient();
  const userRoleRepository = createPrismaUserRoleRepository(prisma);
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `admin-test-${randomUUID()}@example.com`,
        passwordHash: 'hash',
        role: 'CUSTOMER',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  it('finds a user by id and updates its role', async () => {
    const userId = await seedUser();

    expect(await userRoleRepository.findById(userId)).toMatchObject({
      id: userId,
      role: 'CUSTOMER',
    });

    await userRoleRepository.updateRole(userId, 'ADMIN');

    expect(await userRoleRepository.findById(userId)).toMatchObject({ id: userId, role: 'ADMIN' });
  });

  it('returns null for an unknown id', async () => {
    expect(await userRoleRepository.findById(randomUUID())).toBeNull();
  });
});
