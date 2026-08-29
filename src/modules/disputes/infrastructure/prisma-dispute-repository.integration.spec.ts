import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaDisputeRepository } from './prisma-dispute-repository.js';
import { createPrismaEvidenceRepository } from './prisma-evidence-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma dispute + evidence repositories (integration)', () => {
  const prisma = new PrismaClient();
  const disputeRepository = createPrismaDisputeRepository(prisma);
  const evidenceRepository = createPrismaEvidenceRepository(prisma);
  const createdChainIds: bigint[] = [];

  afterAll(async () => {
    if (createdChainIds.length > 0) {
      await prisma.evidence.deleteMany({
        where: { dispute: { chainDeliveryId: { in: createdChainIds } } },
      });
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
  });

  // Dispute.chainDeliveryId is a foreign key into Delivery.chainDeliveryId
  // (same pattern as Escrow), so every test must seed the parent Delivery
  // row first.
  async function nextChainId(): Promise<bigint> {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    await prisma.delivery.create({
      data: {
        chainDeliveryId: id,
        senderAddress: 'GSENDER',
        recipientAddress: 'GRECIPIENT',
        status: 'DISPUTED',
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

  it('upsert creates a dispute when none exists, then updates it in place', async () => {
    const chainDeliveryId = await nextChainId();
    const raisedAt = new Date('2026-01-01T00:00:00Z');

    await disputeRepository.upsert(chainDeliveryId, {
      status: 'OPEN',
      raisedBy: 'GRAISER',
      raisedAt,
    });
    const created = await disputeRepository.findByChainDeliveryId(chainDeliveryId);
    expect(created).toMatchObject({ status: 'OPEN', raisedBy: 'GRAISER' });

    const resolvedAt = new Date('2026-02-01T00:00:00Z');
    await disputeRepository.upsert(chainDeliveryId, {
      status: 'RESOLVED_PAYOUT',
      raisedBy: 'GRAISER',
      raisedAt,
      resolvedBy: 'GADMIN',
      resolvedAt,
    });

    const updated = await disputeRepository.findByChainDeliveryId(chainDeliveryId);
    expect(updated).toMatchObject({
      id: created?.id,
      status: 'RESOLVED_PAYOUT',
      resolvedBy: 'GADMIN',
      resolvedAt,
    });
  });

  it('creates and lists evidence rows for a dispute, ordered by creation time', async () => {
    const chainDeliveryId = await nextChainId();
    await disputeRepository.upsert(chainDeliveryId, {
      status: 'OPEN',
      raisedBy: 'GRAISER',
      raisedAt: new Date(),
    });
    const dispute = await disputeRepository.findByChainDeliveryId(chainDeliveryId);
    if (!dispute) throw new Error('dispute was just created');

    await evidenceRepository.create({
      disputeId: dispute.id,
      hash: 'aa'.repeat(32),
      storageUrl: `${dispute.id}/file-1`,
      contentType: 'image/png',
      uploadedBy: 'GRAISER',
    });
    await evidenceRepository.create({
      disputeId: dispute.id,
      hash: 'bb'.repeat(32),
      storageUrl: `${dispute.id}/file-2`,
      contentType: 'application/pdf',
      uploadedBy: 'GRAISER',
    });

    const evidence = await evidenceRepository.listByDisputeId(dispute.id);
    expect(evidence).toHaveLength(2);
    expect(evidence.map((e) => e.hash)).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
  });

  it('fails with foreign key violation when delivery does not exist (issue #37)', async () => {
    const orphanedDeliveryId = 999_999_999_999n;

    await expect(
      disputeRepository.upsert(orphanedDeliveryId, {
        status: 'OPEN',
        raisedBy: 'GRAISER',
        raisedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
