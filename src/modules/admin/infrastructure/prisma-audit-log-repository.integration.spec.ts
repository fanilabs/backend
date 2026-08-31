import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaAuditLogRepository } from './prisma-audit-log-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma audit log repository (integration)', () => {
  const prisma = new PrismaClient();
  const auditLogRepository = createPrismaAuditLogRepository(prisma);
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedActor(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `admin-test-${randomUUID()}@example.com`,
        passwordHash: 'hash',
        role: 'ADMIN',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  it('records an entry and lists it back, JSON metadata round-tripping', async () => {
    const actorId = await seedActor();

    await auditLogRepository.record({
      actorId,
      actorLabel: 'admin@example.com',
      action: 'user.role_updated',
      entityType: 'User',
      entityId: 'some-user-id',
      metadata: { previousRole: 'CUSTOMER', newRole: 'ADMIN' },
    });

    const entries = await auditLogRepository.list(50);
    const entry = entries.find((e) => e.actorId === actorId);
    expect(entry).toMatchObject({
      actorLabel: 'admin@example.com',
      action: 'user.role_updated',
      entityType: 'User',
      entityId: 'some-user-id',
      metadata: { previousRole: 'CUSTOMER', newRole: 'ADMIN' },
    });
  });

  it('orders newest first, even amongst concurrently-written unrelated rows', async () => {
    // `list` has no actor filter (it's a global admin activity feed by
    // design) — this test only trusts relative order between its own two
    // rows, filtered back out of the full result, since other integration
    // test files can write unrelated audit_logs rows concurrently.
    const actorId = await seedActor();
    await auditLogRepository.record({
      actorId,
      actorLabel: 'admin@example.com',
      action: 'first',
      entityType: 'User',
      entityId: 'x',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await auditLogRepository.record({
      actorId,
      actorLabel: 'admin@example.com',
      action: 'second',
      entityType: 'User',
      entityId: 'x',
    });

    const entries = (await auditLogRepository.list(1000)).filter((e) => e.actorId === actorId);
    expect(entries.map((e) => e.action)).toEqual(['second', 'first']);
  });
});
