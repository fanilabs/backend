import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createUpdateUserRoleUseCase } from '../application/update-user-role.js';
import { createPrismaAdminUnitOfWork } from './prisma-admin-unit-of-work.js';

const prisma = new PrismaClient();
const ids: string[] = [];
afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  ids.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
});
const change = createUpdateUserRoleUseCase({
  unitOfWork: createPrismaAdminUnitOfWork(prisma),
  authCacheInvalidator: { async invalidateUser() {} },
});

async function admins() {
  // This test requires a disposable database, not a shared account catalog.
  expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(0);
  const first = await prisma.user.create({
    data: { email: `${randomUUID()}@admin.invalid`, passwordHash: 'fixture', role: 'ADMIN' },
  });
  const second = await prisma.user.create({
    data: { email: `${randomUUID()}@admin.invalid`, passwordHash: 'fixture', role: 'ADMIN' },
  });
  ids.push(first.id, second.id);
  return { first, second };
}

describe('administrator set invariant on PostgreSQL', () => {
  it.each([1, 2, 3, 4, 5])(
    'preserves one administrator under simultaneous mutual demotions, round %s',
    async () => {
      const { first, second } = await admins();
      const results = await Promise.allSettled([
        change({ actorId: first.id, userId: second.id, role: 'CUSTOMER' }),
        change({ actorId: second.id, userId: first.id, role: 'CUSTOMER' }),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
      expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { actorId: { in: ids } } })).toBe(1);
      const demoted = await prisma.user.findFirstOrThrow({
        where: { id: { in: ids }, role: 'CUSTOMER' },
      });
      expect(demoted.tokenVersion).toBe(1);
    },
  );

  it('rolls back role, sessions and audit and releases the invariant lock', async () => {
    const { first, second } = await admins();
    const family = await prisma.sessionFamily.create({ data: { userId: second.id } });
    const refresh = await prisma.refreshToken.create({
      data: {
        userId: second.id,
        familyId: family.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const real = createPrismaAdminUnitOfWork(prisma);
    const failing = createUpdateUserRoleUseCase({
      unitOfWork: {
        run: (work) =>
          real.run(async (ports) => {
            await work(ports);
            throw new Error('precommit failure');
          }),
      },
      authCacheInvalidator: { async invalidateUser() {} },
    });
    await expect(
      failing({ actorId: first.id, userId: second.id, role: 'CUSTOMER' }),
    ).rejects.toThrow('precommit failure');
    expect(await prisma.user.findUnique({ where: { id: second.id } })).toMatchObject({
      role: 'ADMIN',
      tokenVersion: 0,
    });
    expect(await prisma.refreshToken.findUnique({ where: { id: refresh.id } })).toMatchObject({
      revokedAt: null,
    });
    expect(await prisma.sessionFamily.findUnique({ where: { id: family.id } })).toMatchObject({
      revokedAt: null,
    });
    expect(await prisma.auditLog.count({ where: { actorId: { in: ids } } })).toBe(0);
    await expect(
      change({ actorId: first.id, userId: second.id, role: 'CUSTOMER' }),
    ).resolves.toMatchObject({ role: 'CUSTOMER' });
    expect(await prisma.sessionFamily.findUnique({ where: { id: family.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});
