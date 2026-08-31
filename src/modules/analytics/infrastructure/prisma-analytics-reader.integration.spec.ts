import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaAnalyticsReader } from './prisma-analytics-reader.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma analytics reader (integration)', () => {
  const prisma = new PrismaClient();
  const analyticsReader = createPrismaAnalyticsReader(prisma);
  const createdChainIds: bigint[] = [];
  const createdDriverAddresses: string[] = [];

  afterAll(async () => {
    if (createdChainIds.length > 0) {
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.escrow.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    if (createdDriverAddresses.length > 0) {
      await prisma.driverProfile.deleteMany({ where: { address: { in: createdDriverAddresses } } });
    }
    await prisma.$disconnect();
  });

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
    createdChainIds.push(id);
    return id;
  }

  async function seedDelivery(status: 'PENDING' | 'DELIVERED' | 'CANCELLED') {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        status,
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    return chainDeliveryId;
  }

  it('getGmvByToken sums RELEASED escrow amounts per token, ignoring other statuses', async () => {
    const delivered1 = await seedDelivery('DELIVERED');
    const delivered2 = await seedDelivery('DELIVERED');
    const locked = await seedDelivery('PENDING');
    const token = `TOKEN-${delivered1}`;

    await prisma.escrow.create({
      data: {
        chainDeliveryId: delivered1,
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        driverAddress: Keypair.random().publicKey(),
        token,
        amount: '100',
        status: 'RELEASED',
        createdAtChain: new Date(),
      },
    });
    await prisma.escrow.create({
      data: {
        chainDeliveryId: delivered2,
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        driverAddress: Keypair.random().publicKey(),
        token,
        amount: '170141183460469231731687303715884105727',
        status: 'RELEASED',
        createdAtChain: new Date(),
      },
    });
    await prisma.escrow.create({
      data: {
        chainDeliveryId: locked,
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        driverAddress: Keypair.random().publicKey(),
        token,
        amount: '999',
        status: 'LOCKED',
        createdAtChain: new Date(),
      },
    });

    const rows = await analyticsReader.getGmvByToken();
    const row = rows.find((r) => r.token === token);
    expect(row).toEqual({
      token,
      releasedAmount: 100n + 170141183460469231731687303715884105727n,
      releasedCount: 2,
    });
  });

  it('getDeliveryFunnelCounts counts total/delivered from deliveries and disputed from disputes', async () => {
    const before = await analyticsReader.getDeliveryFunnelCounts();

    await seedDelivery('DELIVERED');
    await seedDelivery('CANCELLED');
    const disputed = await seedDelivery('DELIVERED');
    await prisma.dispute.create({
      data: {
        chainDeliveryId: disputed,
        status: 'OPEN',
        raisedBy: 'GRAISER',
        raisedAt: new Date(),
      },
    });

    const after = await analyticsReader.getDeliveryFunnelCounts();
    expect(after.totalDeliveries - before.totalDeliveries).toBe(3);
    expect(after.deliveredCount - before.deliveredCount).toBe(2);
    expect(after.disputedCount - before.disputedCount).toBe(1);
  });

  it('getDriverTierCounts groups by tier', async () => {
    const before = await analyticsReader.getDriverTierCounts();

    const gold = Keypair.random().publicKey();
    const bronze = Keypair.random().publicKey();
    createdDriverAddresses.push(gold, bronze);
    await prisma.driverProfile.create({
      data: {
        address: gold,
        reputationScore: 90,
        tier: 'GOLD',
        kycVerified: true,
        deliveriesCompleted: 10,
        registeredAt: new Date(),
      },
    });
    await prisma.driverProfile.create({
      data: {
        address: bronze,
        reputationScore: 10,
        tier: 'BRONZE',
        kycVerified: false,
        deliveriesCompleted: 0,
        registeredAt: new Date(),
      },
    });

    const after = await analyticsReader.getDriverTierCounts();
    expect(after.gold - before.gold).toBe(1);
    expect(after.bronze - before.bronze).toBe(1);
    expect(after.silver).toBe(before.silver);
  });
});
