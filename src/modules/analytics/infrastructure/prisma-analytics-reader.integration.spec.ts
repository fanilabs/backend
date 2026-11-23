import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaAnalyticsReader } from './prisma-analytics-reader.js';

/**
 * Integration contract for `createPrismaAnalyticsReader` against a disposable
 * PostgreSQL. Gated on `DATABASE_URL` so it's skipped when no DB is available.
 *
 * Fixtures use unique IDs and are cleaned up in `finally`/`afterAll`; deltas
 * are asserted only for the isolated fixtures this spec inserts, so the
 * assertions hold regardless of pre-existing rows.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb('createPrismaAnalyticsReader (integration)', () => {
  const prisma = new PrismaClient();
  const reader = createPrismaAnalyticsReader(prisma);

  const runId = randomUUID();
  const tokenA = `TOKEN_A_${runId}`;
  const tokenB = `TOKEN_B_${runId}`;
  const deliveryIds: string[] = [];
  const disputeIds: string[] = [];
  const profileIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    try {
      if (disputeIds.length > 0) {
        await prisma.dispute.deleteMany({ where: { id: { in: disputeIds } } });
      }
      if (deliveryIds.length > 0) {
        await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
      }
      if (profileIds.length > 0) {
        await prisma.driverProfile.deleteMany({ where: { id: { in: profileIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('separates released amounts by token', async () => {
    const before = await reader.getGmvByToken();
    const beforeA = before.find((r) => r.token === tokenA);
    const beforeB = before.find((r) => r.token === tokenB);

    const escrowA = await prisma.escrow.create({
      data: {
        token: tokenA,
        amount: 100n,
        status: 'RELEASED',
        isVerified: true,
      },
    });
    const escrowB = await prisma.escrow.create({
      data: {
        token: tokenB,
        amount: 250n,
        status: 'RELEASED',
        isVerified: true,
      },
    });

    try {
      const after = await reader.getGmvByToken();
      const afterA = after.find((r) => r.token === tokenA);
      const afterB = after.find((r) => r.token === tokenB);

      expect((afterA?.releasedAmount ?? 0n) - (beforeA?.releasedAmount ?? 0n)).toBe(100n);
      expect((afterB?.releasedAmount ?? 0n) - (beforeB?.releasedAmount ?? 0n)).toBe(250n);
      expect((afterA?.releasedCount ?? 0) - (beforeA?.releasedCount ?? 0)).toBe(1);
      expect((afterB?.releasedCount ?? 0) - (beforeB?.releasedCount ?? 0)).toBe(1);
    } finally {
      await prisma.escrow.deleteMany({ where: { id: { in: [escrowA.id, escrowB.id] } } });
    }
  });

  it('keeps resolved disputes in the ever-disputed count', async () => {
    const before = await reader.getDeliveryFunnelCounts();

    const delivery = await prisma.delivery.create({
      data: { id: `delivery_${runId}`, status: 'DELIVERED' },
    });
    deliveryIds.push(delivery.id);

    const dispute = await prisma.dispute.create({
      data: {
        id: `dispute_${runId}`,
        chainDeliveryId: delivery.id,
        status: 'RESOLVED',
      },
    });
    disputeIds.push(dispute.id);

    try {
      const after = await reader.getDeliveryFunnelCounts();
      expect(after.totalDeliveries - before.totalDeliveries).toBe(1);
      expect(after.deliveredCount - before.deliveredCount).toBe(1);
      expect(after.disputedCount - before.disputedCount).toBe(1);
    } finally {
      await prisma.dispute.deleteMany({ where: { id: { in: [dispute.id] } } });
      await prisma.delivery.deleteMany({ where: { id: { in: [delivery.id] } } });
    }
  });

  it('changes only the silver group when a SILVER profile is added', async () => {
    const before = await reader.getDriverTierCounts();

    const profile = await prisma.driverProfile.create({
      data: { id: `profile_${runId}`, tier: 'SILVER' },
    });
    profileIds.push(profile.id);

    try {
      const after = await reader.getDriverTierCounts();
      expect(after.silver - before.silver).toBe(1);
      expect(after.bronze - before.bronze).toBe(0);
      expect(after.gold - before.gold).toBe(0);
    } finally {
      await prisma.driverProfile.deleteMany({ where: { id: { in: [profile.id] } } });
    }
  });
});
