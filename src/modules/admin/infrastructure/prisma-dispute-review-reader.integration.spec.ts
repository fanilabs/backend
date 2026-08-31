import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaDisputeReviewReader } from './prisma-dispute-review-reader.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma dispute review reader (integration)', () => {
  const prisma = new PrismaClient();
  const disputeReviewReader = createPrismaDisputeReviewReader(prisma);
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

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
    createdChainIds.push(id);
    return id;
  }

  async function seedDelivery(): Promise<bigint> {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        status: 'DISPUTED',
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

  it('lists only OPEN disputes, with an evidence count, ordered oldest-raised-first', async () => {
    const openOlder = await seedDelivery();
    const openNewer = await seedDelivery();
    const resolved = await seedDelivery();

    await prisma.dispute.create({
      data: {
        chainDeliveryId: openOlder,
        status: 'OPEN',
        raisedBy: 'GRAISER1',
        raisedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const disputeWithEvidence = await prisma.dispute.create({
      data: {
        chainDeliveryId: openNewer,
        status: 'OPEN',
        raisedBy: 'GRAISER2',
        raisedAt: new Date('2026-01-02T00:00:00Z'),
      },
    });
    await prisma.evidence.create({
      data: {
        disputeId: disputeWithEvidence.id,
        hash: 'a'.repeat(64),
        storageUrl: 'ignored/for-this-test',
        contentType: 'text/plain',
        uploadedBy: 'GRAISER2',
      },
    });
    await prisma.dispute.create({
      data: {
        chainDeliveryId: resolved,
        status: 'RESOLVED_REFUND',
        raisedBy: 'GRAISER3',
        raisedAt: new Date(),
        resolvedBy: 'GADMIN',
        resolvedAt: new Date(),
      },
    });

    const results = await disputeReviewReader.listOpenDisputes();
    const relevant = results.filter((r) => createdChainIds.includes(r.chainDeliveryId));

    expect(relevant).toEqual([
      {
        chainDeliveryId: openOlder,
        status: 'OPEN',
        raisedBy: 'GRAISER1',
        raisedAt: new Date('2026-01-01T00:00:00Z'),
        evidenceCount: 0,
      },
      {
        chainDeliveryId: openNewer,
        status: 'OPEN',
        raisedBy: 'GRAISER2',
        raisedAt: new Date('2026-01-02T00:00:00Z'),
        evidenceCount: 1,
      },
    ]);
  });
});
