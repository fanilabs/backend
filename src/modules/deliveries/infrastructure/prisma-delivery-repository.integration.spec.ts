import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaDeliveryRepository } from './prisma-delivery-repository.js';
import { DeliveryNotFoundError } from '../domain/index.js';
import { buildChainDeliveryRecord } from '../application/__fixtures__/fakes.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';
import { createChainIdAllocator } from '../../../shared/testing/id-allocator.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma delivery repository (integration)', () => {
  const prisma = new PrismaClient();
  const deliveryRepository = createPrismaDeliveryRepository(prisma);
  const allocator = createChainIdAllocator();

  afterAll(async () => {
    if (allocator.allocated.length > 0) {
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: [...allocator.allocated] } } });
    }
    await prisma.$disconnect();
  });

  it('creates a delivery and finds it by chain id', async () => {
    const chainDeliveryId = allocator.next();
    const record = buildChainDeliveryRecord({ chainDeliveryId, origin: 'Kigali' });

    const created = await deliveryRepository.create(record);
    expect(created.origin).toBe('Kigali');

    const found = await deliveryRepository.findByChainId(chainDeliveryId);
    expect(found).toMatchObject({ chainDeliveryId, origin: 'Kigali' });
  });

  it('updates status and driver via updateStatus', async () => {
    const chainDeliveryId = allocator.next();
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
    const chainDeliveryId = allocator.next();
    await deliveryRepository.create(
      buildChainDeliveryRecord({ chainDeliveryId, senderAddress: sender }),
    );

    const results = await deliveryRepository.list({ senderAddress: sender });
    expect(results).toHaveLength(1);
    expect(results[0]?.chainDeliveryId).toBe(chainDeliveryId);
  });

  it('recovers from a transient database connection drop on updateStatus', async () => {
    const chainDeliveryId = allocator.next();
    await deliveryRepository.create(
      buildChainDeliveryRecord({ chainDeliveryId, status: 'PENDING' }),
    );

    const originalUpdate = (prisma.delivery as any).update.bind(prisma.delivery);
    let attempts = 0;
    (prisma.delivery as any).update = async (args: any) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('Connection terminated unexpectedly by the server');
        (error as any).code = 'P500';
        throw error;
      }
      return originalUpdate(args);
    };

    try {
      await deliveryRepository.updateStatus(chainDeliveryId, {
        status: 'ACTIVE',
        driverAddress: 'GDRIVER',
      });

      expect(attempts).toBe(2);

      const updated = await deliveryRepository.findByChainId(chainDeliveryId);
      expect(updated?.status).toBe('ACTIVE');
      expect(updated?.driverAddress).toBe('GDRIVER');
    } finally {
      (prisma.delivery as any).update = originalUpdate;
    }
  });

  it('is an idempotent no-op when the status is already current (duplicate event)', async () => {
    const chainDeliveryId = allocator.next();
    await deliveryRepository.create(
      buildChainDeliveryRecord({ chainDeliveryId, status: 'PENDING' }),
    );

    await deliveryRepository.updateStatus(chainDeliveryId, { status: 'ACTIVE' });
    await deliveryRepository.updateStatus(chainDeliveryId, { status: 'ACTIVE' });

    const updated = await deliveryRepository.findByChainId(chainDeliveryId);
    expect(updated?.status).toBe('ACTIVE');
  });

  it('throws DeliveryNotFoundError when the delivery does not exist', async () => {
    const chainDeliveryId = allocator.next();
    await expect(
      deliveryRepository.updateStatus(chainDeliveryId, { status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(DeliveryNotFoundError);
  });
});
