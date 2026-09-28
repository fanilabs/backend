import { randomUUID } from 'node:crypto';
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
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdChainIds.length > 0) {
      await prisma.evidence.deleteMany({
        where: { dispute: { chainDeliveryId: { in: createdChainIds } } },
      });
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  // disputes.raised_by_user_id is a real FK into users.id — a non-existent
  // id would fail with a foreign-key violation, not exercise the create-vs-
  // update semantics this test actually cares about.
  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `dispute-raiser-test-${randomUUID()}@example.com`, passwordHash: 'hash' },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

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
      uploadedByUserId: null,
    });
    await evidenceRepository.create({
      disputeId: dispute.id,
      hash: 'bb'.repeat(32),
      storageUrl: `${dispute.id}/file-2`,
      contentType: 'application/pdf',
      uploadedBy: 'GRAISER',
      uploadedByUserId: null,
    });

    const evidence = await evidenceRepository.listByDisputeId(dispute.id);
    expect(evidence).toHaveLength(2);
    expect(evidence.map((e) => e.hash)).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
  });

  it('upsert sets raisedByUserId only on creation and never reassigns it on a later update (B2.1: raiser wallet-relink evidence authorization)', async () => {
    const chainDeliveryId = await nextChainId();
    const raisedAt = new Date('2026-01-01T00:00:00Z');
    const originalRaiserId = await seedUser();
    const newOwnerId = await seedUser();

    await disputeRepository.upsert(chainDeliveryId, {
      status: 'OPEN',
      raisedBy: 'GRAISER',
      raisedAt,
      raisedByUserId: originalRaiserId,
    });
    const created = await disputeRepository.findByChainDeliveryId(chainDeliveryId);
    expect(created?.raisedByUserId).toBe(originalRaiserId);

    // Simulates a replayed dispute_raised event (or any other later upsert)
    // that resolves a *different* raisedByUserId — e.g. because the wallet
    // was relinked to a new owner in the meantime. This must never reach
    // the database: `createPrismaDisputeRepository.upsert` only ever
    // includes `raisedByUserId` in the `create` branch of the Prisma
    // `upsert`, never `update`, so this call's `raisedByUserId` is silently
    // ignored on the conflict path — verified here against a real Postgres
    // `INSERT ... ON CONFLICT DO UPDATE`, not just the in-memory test fake.
    await disputeRepository.upsert(chainDeliveryId, {
      status: 'OPEN',
      raisedBy: 'GRAISER',
      raisedAt,
      raisedByUserId: newOwnerId,
    });

    const stillOriginal = await disputeRepository.findByChainDeliveryId(chainDeliveryId);
    expect(stillOriginal?.raisedByUserId).toBe(originalRaiserId);
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
