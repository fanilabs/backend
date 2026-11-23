import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDeliveryPartyLookup } from './prisma-delivery-party-lookup.js';

const prisma = new PrismaClient();
const lookup = createPrismaDeliveryPartyLookup(prisma);

const seededIds: bigint[] = [];

async function seedDelivery(params: {
  chainDeliveryId: bigint;
  sender: string;
  recipient: string;
  driver: string | null;
}) {
  seededIds.push(params.chainDeliveryId);
  await prisma.delivery.create({
    data: {
      chainDeliveryId: params.chainDeliveryId,
      sender: params.sender,
      recipient: params.recipient,
      driver: params.driver,
    },
  });
}

afterAll(async () => {
  try {
    if (seededIds.length > 0) {
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: seededIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe('createPrismaDeliveryPartyLookup (integration)', () => {
  it('returns null for an unknown delivery id', async () => {
    const result = await lookup.findParties('999999999999');
    expect(result).toBeNull();
  });

  it('maps sender and recipient and keeps an unassigned driver null', async () => {
    const chainDeliveryId = 6130001n;
    await seedDelivery({
      chainDeliveryId,
      sender: 'GSENDER613',
      recipient: 'GRECIPIENT613',
      driver: null,
    });

    const result = await lookup.findParties(chainDeliveryId.toString());
    expect(result).toEqual({
      sender: 'GSENDER613',
      recipient: 'GRECIPIENT613',
      driver: null,
    });
  });

  it('maps an assigned driver', async () => {
    const chainDeliveryId = 6130002n;
    await seedDelivery({
      chainDeliveryId,
      sender: 'GSENDER613B',
      recipient: 'GRECIPIENT613B',
      driver: 'GDRIVER613B',
    });

    const result = await lookup.findParties(chainDeliveryId.toString());
    expect(result).toEqual({
      sender: 'GSENDER613B',
      recipient: 'GRECIPIENT613B',
      driver: 'GDRIVER613B',
    });
  });

  it('selects exactly the seeded delivery for a decimal id above the JS safe-integer boundary', async () => {
    const largeId = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    await seedDelivery({
      chainDeliveryId: largeId,
      sender: 'GSENDER613LARGE',
      recipient: 'GRECIPIENT613LARGE',
      driver: null,
    });

    const result = await lookup.findParties(largeId.toString());
    expect(result).toEqual({
      sender: 'GSENDER613LARGE',
      recipient: 'GRECIPIENT613LARGE',
      driver: null,
    });
  });
});
