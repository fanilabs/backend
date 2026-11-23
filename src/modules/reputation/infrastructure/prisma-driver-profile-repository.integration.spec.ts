import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaDriverProfileRepository } from './prisma-driver-profile-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const prisma = databaseUrl ? new PrismaClient() : null;

function uniqueAddress(): string {
  return `0x${randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40)}`;
}

function baseFields(address: string) {
  return {
    address,
    reputationScore: 0,
    tier: 'BRONZE' as const,
    kycVerified: false,
    deliveriesCompleted: 0,
    registeredAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

describeIfDatabase('PrismaDriverProfileRepository integration', () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('defaults legacyDeliveriesCompleted to zero when omitted on create', async () => {
    const address = uniqueAddress();
    try {
      const repository = createPrismaDriverProfileRepository(prisma!);
      await repository.upsert(address, baseFields(address));

      const stored = await prisma!.driverProfile.findUnique({ where: { address } });
      expect(stored?.legacyDeliveriesCompleted).toBe(0);
    } finally {
      await prisma!.driverProfile.deleteMany({ where: { address } });
    }
  });

  it('preserves legacyDeliveriesCompleted when omitted on update', async () => {
    const address = uniqueAddress();
    try {
      const repository = createPrismaDriverProfileRepository(prisma!);
      await repository.upsert(address, {
        ...baseFields(address),
        legacyDeliveriesCompleted: 7,
      });
      await repository.upsert(address, baseFields(address));

      const stored = await prisma!.driverProfile.findUnique({ where: { address } });
      expect(stored?.legacyDeliveriesCompleted).toBe(7);
    } finally {
      await prisma!.driverProfile.deleteMany({ where: { address } });
    }
  });

  it('replaces a prior nonzero legacyDeliveriesCompleted with explicit zero and preserves zero on omission', async () => {
    const address = uniqueAddress();
    try {
      const repository = createPrismaDriverProfileRepository(prisma!);

      await repository.upsert(address, {
        ...baseFields(address),
        legacyDeliveriesCompleted: 5,
      });
      const afterNonzero = await prisma!.driverProfile.findUnique({ where: { address } });
      expect(afterNonzero?.legacyDeliveriesCompleted).toBe(5);
      const originalId = afterNonzero!.id;
      const originalCreatedAt = afterNonzero!.createdAt;

      await repository.upsert(address, {
        ...baseFields(address),
        legacyDeliveriesCompleted: 0,
      });
      const afterZero = await prisma!.driverProfile.findUnique({ where: { address } });
      expect(afterZero?.legacyDeliveriesCompleted).toBe(0);
      expect(afterZero?.id).toBe(originalId);
      expect(afterZero?.createdAt).toEqual(originalCreatedAt);

      await repository.upsert(address, baseFields(address));
      const afterOmission = await prisma!.driverProfile.findUnique({ where: { address } });
      expect(afterOmission?.legacyDeliveriesCompleted).toBe(0);
      expect(afterOmission?.id).toBe(originalId);
      expect(afterOmission?.createdAt).toEqual(originalCreatedAt);
    } finally {
      await prisma!.driverProfile.deleteMany({ where: { address } });
    }
  });
});
