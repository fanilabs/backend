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

  // #674 — `record` only conditionally writes `metadata` at all, and
  // `toDomain` normalizes its absence to `null`; the only existing JSON
  // coverage above is a flat role-change object. These two cases close the
  // gap: a non-role action proves nested arrays/objects and Unicode text
  // round-trip exactly (not just flat string fields), and a second entry
  // with `metadata` entirely omitted proves the read path reports `null`
  // rather than `undefined` or `{}`.
  it('round-trips nested JSON metadata with Unicode text for a non-role action', async () => {
    const actorId = await seedActor();
    const metadata = {
      reason: 'fraude détectée — 詐欺が検出されました 🚩',
      tags: ['critical', 'ñ', { nested: true, values: [1, 2, 3] }],
      context: { ip: '203.0.113.9', notes: null },
    };

    await auditLogRepository.record({
      actorId,
      actorLabel: 'admin@example.com',
      action: 'delivery.flagged',
      entityType: 'Delivery',
      entityId: 'delivery-123',
      metadata,
    });

    const entries = await auditLogRepository.list({ limit: 50 });
    const entry = entries.find((e) => e.actorId === actorId && e.action === 'delivery.flagged');
    expect(entry?.metadata).toEqual(metadata);
  });

  it('reports metadata as explicit null when omitted from record()', async () => {
    const actorId = await seedActor();

    await auditLogRepository.record({
      actorId,
      actorLabel: 'admin@example.com',
      action: 'session.revoked',
      entityType: 'Session',
      entityId: 'session-456',
    });

    const entries = await auditLogRepository.list({ limit: 50 });
    const entry = entries.find((e) => e.actorId === actorId && e.action === 'session.revoked');
    expect(entry?.metadata).toBeNull();
  });

  it('orders newest first, even amongst concurrently-written unrelated rows', async () => {
    // `list` has no actor filter (it's a global admin activity feed by
    // design) — this test only trusts relative order between its own two
    // rows, filtered back out of the full result, since other integration
    // test files can write unrelated audit_logs rows concurrently.
    const actorId = await seedActor();
    const t0 = Date.now();
    await prisma.auditLog.create({
      data: {
        actorId,
        actorLabel: 'admin@example.com',
        action: 'first',
        entityType: 'User',
        entityId: 'x',
        createdAt: new Date(t0),
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        actorLabel: 'admin@example.com',
        action: 'second',
        entityType: 'User',
        entityId: 'x',
        createdAt: new Date(t0 + 1000),
      },
    });

    const entries = (await auditLogRepository.list({ limit: 1000 })).filter(
      (e) => e.actorId === actorId,
    );
    expect(entries.map((e) => e.action)).toEqual(['second', 'first']);
  });

  it('pages through entries without duplicates or gaps using ID cursor', async () => {
    const actorId = await seedActor();
    // Use explicit timestamps spaced 1 s apart so ordering is deterministic
    // without relying on sleep-based timing or insertion order.
    const baseTime = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await prisma.auditLog.create({
        data: {
          actorId,
          actorLabel: 'admin@example.com',
          action: `cursor-test-${i}`,
          entityType: 'User',
          entityId: `u-${i}`,
          createdAt: new Date(baseTime + i * 1000),
        },
      });
    }

    // Fetch a wide window so concurrent inserts from other suites cannot
    // displace our 5 rows off the first page, then narrow to this actor.
    const allEntries = await auditLogRepository.list({ limit: 1000 });
    const ours = allEntries.filter((e) => e.actorId === actorId);
    expect(ours).toHaveLength(5);

    // Simulate page-of-2 navigation using the cursor the repository exposes.
    // Page 1: first 2 of our rows (newest first from the global list).
    const page1Ids = ours.slice(0, 2).map((e) => e.id);
    const cursor1 = page1Ids[page1Ids.length - 1]!;

    const page2Raw = await auditLogRepository.list({ limit: 1000, before: cursor1 });
    const page2 = page2Raw.filter((e) => e.actorId === actorId);
    expect(page2).toHaveLength(3);
    const page2SliceIds = page2.slice(0, 2).map((e) => e.id);
    const cursor2 = page2SliceIds[page2SliceIds.length - 1]!;

    const page3Raw = await auditLogRepository.list({ limit: 1000, before: cursor2 });
    const page3 = page3Raw.filter((e) => e.actorId === actorId);
    expect(page3).toHaveLength(1);

    // No duplicates across the three simulated pages.
    const allIds = [...page1Ids, ...page2SliceIds, ...page3.map((e) => e.id)];
    expect(new Set(allIds).size).toBe(5);

    // All 5 combined, ordered newest-first (largest createdAt first).
    const combined = [...ours.slice(0, 2), ...page2.slice(0, 2), ...page3];
    const createdAts = combined.map((e) => e.createdAt.getTime());
    for (let i = 1; i < createdAts.length; i += 1) {
      expect(createdAts[i]).toBeLessThanOrEqual(createdAts[i - 1]!);
    }
  });

  // GDPR / account-deletion compliance (#361): the `AuditLog.actor`
  // relation is `onDelete: SetNull`, so purging a user preserves their
  // audit trail while nulling the reference instead of raising P2003.
  it('nulls AuditLog.actorId (keeping the log row) when the actor user is deleted', async () => {
    const actorId = await seedActor();

    await auditLogRepository.record({
      actorId,
      actorLabel: 'admin@example.com',
      action: 'user.role_updated',
      entityType: 'User',
      entityId: 'some-user-id',
      metadata: { previousRole: 'CUSTOMER', newRole: 'ADMIN' },
    });

    await prisma.user.delete({ where: { id: actorId } });
    createdUserIds.splice(createdUserIds.indexOf(actorId), 1);

    const orphaned = await prisma.auditLog.findMany({ where: { action: 'user.role_updated' } });
    const entry = orphaned.find((e) => e.actorLabel === 'admin@example.com');
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBeNull();
  });

  it('lists only entries matching actorId and action filters', async () => {
    const actorOne = await seedActor();
    const actorTwo = await seedActor();

    await auditLogRepository.record({
      actorId: actorOne,
      actorLabel: 'one@example.com',
      action: 'user.role_updated',
      entityType: 'User',
      entityId: 'u-1',
    });
    await auditLogRepository.record({
      actorId: actorOne,
      actorLabel: 'one@example.com',
      action: 'escrow.refunded',
      entityType: 'Escrow',
      entityId: 'e-1',
    });
    await auditLogRepository.record({
      actorId: actorTwo,
      actorLabel: 'two@example.com',
      action: 'user.role_updated',
      entityType: 'User',
      entityId: 'u-2',
    });

    const byActor = await auditLogRepository.list({
      limit: 100,
      actorId: actorTwo,
    });
    expect(byActor).toHaveLength(1);
    expect(byActor[0]!.action).toBe('user.role_updated');

    const byAction = await auditLogRepository.list({
      limit: 100,
      action: 'user.role_updated',
    });
    const ourByAction = byAction.filter((e) => [actorOne, actorTwo].includes(e.actorId!));
    expect(ourByAction).toHaveLength(2);

    const composed = await auditLogRepository.list({
      limit: 100,
      actorId: actorOne,
      action: 'escrow.refunded',
    });
    expect(composed).toHaveLength(1);
    expect(composed[0]!.actorId).toBe(actorOne);
  });
});
