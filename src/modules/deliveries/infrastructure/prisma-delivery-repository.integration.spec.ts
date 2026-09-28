import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaDeliveryRepository } from './prisma-delivery-repository.js';
import { buildChainDeliveryRecord } from '../application/__fixtures__/fakes.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma delivery repository (integration)', () => {
  const prisma = new PrismaClient();
  const deliveryRepository = createPrismaDeliveryRepository(prisma);
  const createdChainIds: bigint[] = [];

  afterAll(async () => {
    if (createdChainIds.length > 0) {
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
  });

  function nextChainId(): bigint {
    // Random-ish, large, and unique per test run to avoid collisions with
    // any other data in a shared test database.
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  it('creates a delivery and finds it by chain id', async () => {
    const chainDeliveryId = nextChainId();
    const record = buildChainDeliveryRecord({ chainDeliveryId, origin: 'Kigali' });

    const created = await deliveryRepository.create(record);
    expect(created.origin).toBe('Kigali');

    const found = await deliveryRepository.findByChainId(chainDeliveryId);
    expect(found).toMatchObject({ chainDeliveryId, origin: 'Kigali' });
  });

  it('updates status and driver via updateStatus', async () => {
    const chainDeliveryId = nextChainId();
    await deliveryRepository.create(
      buildChainDeliveryRecord({ chainDeliveryId, status: 'PENDING' }),
    );

    await deliveryRepository.updateStatus(chainDeliveryId, {
      status: 'ACTIVE',
      driverAddress: 'GDRIVER',
    });

    const updated = await deliveryRepository.findByChainId(chainDeliveryId);
    expect(updated?.status).toBe('ACTIVE');
    expect(updated?.driverAddress).toBe('GDRIVER');
  });

  it('lists deliveries filtered by sender address', async () => {
    const sender = `GSENDER-${randomUUID()}`;
    const chainDeliveryId = nextChainId();
    await deliveryRepository.create(
      buildChainDeliveryRecord({ chainDeliveryId, senderAddress: sender }),
    );

    const results = await deliveryRepository.list({ senderAddress: sender });
    expect(results).toHaveLength(1);
    expect(results[0]?.chainDeliveryId).toBe(chainDeliveryId);
  });
});
