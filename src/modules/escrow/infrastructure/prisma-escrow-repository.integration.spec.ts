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

  it.each([true, false, undefined])(
    'persists explicit token verification %s and excludes unknown state',
    async (isVerified) => {
      const chainDeliveryId = await nextChainId();
      const record = buildChainEscrowRecord({ chainDeliveryId });
      // Undefined models a caller without an ingestion-policy result.
      if (isVerified !== undefined) record.isVerified = isVerified;
      const created = await escrowRepository.create(record);
      expect(created.isVerified).toBe(isVerified ?? false);
      await escrowRepository.updateStatus(chainDeliveryId, { status: 'RELEASED' });
      const found = await escrowRepository.findByChainDeliveryId(chainDeliveryId);
      expect(found?.isVerified).toBe(isVerified ?? false);
    },
  );

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

  describe('transaction atomicity (#387)', () => {
    it('rolls back escrow status update when a secondary query fails', async () => {
      const chainDeliveryId = await nextChainId();
      await escrowRepository.create(buildChainEscrowRecord({ chainDeliveryId, status: 'LOCKED' }));

      await expect(
        escrowRepository.updateStatus(
          chainDeliveryId,
          { status: 'RELEASED', releasedAt: new Date() },
          async () => {
            // Simulated crash or failure in secondary query (audit logging / correlation)
            throw new Error('Simulated failure in secondary query');
          },
        ),
      ).rejects.toThrow('Simulated failure in secondary query');

      // Escrow status must remain strictly unchanged in the database (ACID rollback)
      const persisted = await escrowRepository.findByChainDeliveryId(chainDeliveryId);
      expect(persisted?.status).toBe('LOCKED');
      expect(persisted?.releasedAt).toBeNull();
    });

    it('commits escrow status update and secondary correlated write together atomically', async () => {
      const chainDeliveryId = await nextChainId();
      await escrowRepository.create(buildChainEscrowRecord({ chainDeliveryId, status: 'LOCKED' }));
      const releasedAt = new Date('2026-06-01T00:00:00Z');

      let secondaryExecuted = false;
      await escrowRepository.updateStatus(
        chainDeliveryId,
        { status: 'RELEASED', releasedAt },
        async (tx) => {
          // Secondary write within same transaction boundary
          await (tx as PrismaClient).delivery.update({
            where: { chainDeliveryId },
            data: { status: 'DELIVERED' },
          });
          secondaryExecuted = true;
        },
      );

      expect(secondaryExecuted).toBe(true);
      const updatedEscrow = await escrowRepository.findByChainDeliveryId(chainDeliveryId);
      expect(updatedEscrow?.status).toBe('RELEASED');
      expect(updatedEscrow?.releasedAt).toEqual(releasedAt);

      const updatedDelivery = await prisma.delivery.findUnique({ where: { chainDeliveryId } });
      expect(updatedDelivery?.status).toBe('DELIVERED');
    });
  });
});
