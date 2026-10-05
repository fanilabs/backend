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

    const entries = await auditLogRepository.list({ limit: 50 });
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

    const entries = (await auditLogRepository.list({ limit: 1000 })).filter(
      (e) => e.actorId === actorId,
    );
    expect(entries.map((e) => e.action)).toEqual(['second', 'first']);
  });

  it('pages through entries without duplicates or gaps using ID cursor', async () => {
    const actorId = await seedActor();
    // Insert 5 entries with explicit delays to guarantee distinct createdAt values
    // and thus a reliable ordering without depending on same-millisecond tiebreaking.
    for (let i = 0; i < 5; i += 1) {
      await auditLogRepository.record({
        actorId,
        actorLabel: 'admin@example.com',
        action: `cursor-test-${i}`,
        entityType: 'User',
        entityId: `u-${i}`,
      });
      if (i < 4) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    // Page 1: fetch 2 entries.
    const page1 = await auditLogRepository.list({ limit: 2 });
    const ourPage1 = page1.filter((e) => e.actorId === actorId);
    expect(ourPage1).toHaveLength(2);

    // Page 2: fetch the next 2 entries using the last item's ID as cursor.
    const cursor1 = ourPage1[ourPage1.length - 1]!.id;
    const page2 = await auditLogRepository.list({ limit: 2, before: cursor1 });
    const ourPage2 = page2.filter((e) => e.actorId === actorId);
    expect(ourPage2).toHaveLength(2);

    // Page 3: fetch remaining entry.
    const cursor2 = ourPage2[ourPage2.length - 1]!.id;
    const page3 = await auditLogRepository.list({ limit: 2, before: cursor2 });
    const ourPage3 = page3.filter((e) => e.actorId === actorId);
    expect(ourPage3).toHaveLength(1);

    // No duplicates across the three pages.
    const allIds = [...ourPage1, ...ourPage2, ...ourPage3].map((e) => e.id);
    expect(new Set(allIds).size).toBe(5);

    // Ordering is newest-first across all pages.
    const createdAts = [...ourPage1, ...ourPage2, ...ourPage3].map((e) => e.createdAt.getTime());
    for (let i = 1; i < createdAts.length; i += 1) {
      expect(createdAts[i]).toBeLessThanOrEqual(createdAts[i - 1]!);
    }
  });
});
