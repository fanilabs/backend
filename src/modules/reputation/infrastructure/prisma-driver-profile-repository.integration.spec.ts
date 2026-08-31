import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaDriverProfileRepository } from './prisma-driver-profile-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma driver profile repository (integration)', () => {
  const prisma = new PrismaClient();
  const driverProfileRepository = createPrismaDriverProfileRepository(prisma);
  const createdAddresses: string[] = [];

  afterAll(async () => {
    if (createdAddresses.length > 0) {
      await prisma.driverProfile.deleteMany({ where: { address: { in: createdAddresses } } });
    }
    await prisma.$disconnect();
  });

  function nextAddress(): string {
    const address = `GDRIVER-${randomUUID()}`;
    createdAddresses.push(address);
    return address;
  }

  it('upsert creates a driver profile when none exists, defaulting legacyDeliveriesCompleted to 0', async () => {
    const address = nextAddress();
    const registeredAt = new Date('2026-01-01T00:00:00Z');

    await driverProfileRepository.upsert(address, {
      reputationScore: 50,
      tier: 'SILVER',
      kycVerified: false,
      deliveriesCompleted: 0,
      registeredAt,
    });

    const created = await driverProfileRepository.findByAddress(address);
    expect(created).toMatchObject({
      reputationScore: 50,
      tier: 'SILVER',
      kycVerified: false,
      legacyDeliveriesCompleted: 0,
    });
  });

  it('upsert updates in place and preserves legacyDeliveriesCompleted when omitted from a later call', async () => {
    const address = nextAddress();
    await driverProfileRepository.upsert(address, {
      reputationScore: 50,
      tier: 'SILVER',
      kycVerified: false,
      deliveriesCompleted: 0,
      registeredAt: new Date(),
      legacyDeliveriesCompleted: 4,
    });

    await driverProfileRepository.upsert(address, {
      reputationScore: 63,
      tier: 'SILVER',
      kycVerified: true,
      deliveriesCompleted: 1,
      registeredAt: new Date(),
    });

    const updated = await driverProfileRepository.findByAddress(address);
    expect(updated).toMatchObject({
      reputationScore: 63,
      kycVerified: true,
      deliveriesCompleted: 1,
      legacyDeliveriesCompleted: 4,
    });
  });
});
