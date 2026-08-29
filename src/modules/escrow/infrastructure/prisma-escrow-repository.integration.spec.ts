import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaEscrowRepository } from './prisma-escrow-repository.js';
import { buildChainEscrowRecord } from '../application/__fixtures__/fakes.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma escrow repository (integration)', () => {
  const prisma = new PrismaClient();
  const escrowRepository = createPrismaEscrowRepository(prisma);
  const createdChainIds: bigint[] = [];

  afterAll(async () => {
    if (createdChainIds.length > 0) {
      await prisma.escrow.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
  });

  // Escrow.chainDeliveryId is a foreign key into Delivery.chainDeliveryId
  // (both read models key off the same on-chain delivery id), so every test
  // must seed the parent Delivery row first.
  async function nextChainId(): Promise<bigint> {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    await prisma.delivery.create({
      data: {
        chainDeliveryId: id,
        senderAddress: 'GSENDER',
        recipientAddress: 'GRECIPIENT',
        status: 'PENDING',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 100,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    return id;
  }

  it('creates an escrow and finds it by chain delivery id', async () => {
    const chainDeliveryId = await nextChainId();
    const record = buildChainEscrowRecord({ chainDeliveryId, token: 'GTOKENX' });

    const created = await escrowRepository.create(record);
    expect(created.token).toBe('GTOKENX');
    expect(created.platformFee).toBeNull();

    const found = await escrowRepository.findByChainDeliveryId(chainDeliveryId);
    expect(found).toMatchObject({ chainDeliveryId, token: 'GTOKENX', status: 'LOCKED' });
  });

  it('updates status, platformFee, and releasedAt via updateStatus', async () => {
    const chainDeliveryId = await nextChainId();
    await escrowRepository.create(buildChainEscrowRecord({ chainDeliveryId, status: 'LOCKED' }));
    const releasedAt = new Date('2026-01-01T00:00:00Z');

    await escrowRepository.updateStatus(chainDeliveryId, {
      status: 'RELEASED',
      platformFee: 50_000n,
      releasedAt,
    });

    const updated = await escrowRepository.findByChainDeliveryId(chainDeliveryId);
    expect(updated?.status).toBe('RELEASED');
    expect(updated?.platformFee).toBe(50_000n);
    expect(updated?.releasedAt).toEqual(releasedAt);
  });

  it('round-trips i128::MAX (39 digits) without precision loss or overflow', async () => {
    const chainDeliveryId = await nextChainId();
    // Decimal(39, 0) is exactly wide enough for this — Decimal(38, 0) would
    // overflow by one digit (see prisma/schema.prisma's comment on Escrow.amount).
    const amount = 170_141_183_460_469_231_731_687_303_715_884_105_727n;
    await escrowRepository.create(buildChainEscrowRecord({ chainDeliveryId, amount }));

    const found = await escrowRepository.findByChainDeliveryId(chainDeliveryId);
    expect(found?.amount).toBe(amount);
  });

  it('fails with foreign key violation when delivery does not exist (issue #37)', async () => {
    const orphanedDeliveryId = 999_999_999_999n;
    const record = buildChainEscrowRecord({ chainDeliveryId: orphanedDeliveryId });

    await expect(escrowRepository.create(record)).rejects.toThrow();
  });
});
