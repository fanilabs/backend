import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDeliveryRepository } from './prisma-delivery-repository.js';
import type { DeliveryRepository } from '../domain/index.js';

/**
 * Integration coverage for the Prisma delivery repository read filters (#617).
 *
 * Requires a disposable PostgreSQL instance via DATABASE_URL. The suite is
 * skipped when the variable is absent so unit runs stay hermetic.
 */
const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const RUN_ID = `it617-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function chainId(suffix: string): string {
  return `${RUN_ID}-${suffix}`;
}

describeIfDatabase('prisma delivery repository read filters', () => {
  let prisma: PrismaClient;
  let repository: DeliveryRepository;
  const createdIds: string[] = [];

  const baseRecord = (suffix: string, overrides: Record<string, unknown> = {}) => ({
    chainDeliveryId: chainId(suffix),
    senderAddress: '0xsender-default',
    recipientAddress: '0xrecipient-default',
    driverAddress: '0xdriver-default' as string | null,
    status: 'CREATED',
    origin: 'origin',
    destination: 'destination',
    cargoCategory: 'GENERAL',
    weightGrams: 1000,
    fragile: false,
    createdAtChain: new Date('2024-01-01T00:00:00.000Z'),
    transitStartedAt: null,
    deliveredAt: null,
    ...overrides,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    repository = createPrismaDeliveryRepository(prisma);
  });

  afterAll(async () => {
    try {
      if (createdIds.length > 0) {
        await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function seed(records: Array<Record<string, unknown>>): Promise<void> {
    for (const record of records) {
      const created = await repository.create(record as never);
      createdIds.push(created.chainDeliveryId);
    }
  }

  it('combines all supplied predicates as an intersection', async () => {
    const sender = chainId('sender');
    const recipient = chainId('recipient');
    const driver = chainId('driver');
    const status = 'IN_TRANSIT';

    await seed([
      // Matches sender only.
      baseRecord('sender-only', { senderAddress: sender }),
      // Matches recipient only.
      baseRecord('recipient-only', { recipientAddress: recipient }),
      // Matches driver only.
      baseRecord('driver-only', { driverAddress: driver }),
      // Matches status only.
      baseRecord('status-only', { status }),
      // Matches sender + recipient but not driver/status.
      baseRecord('sender-recipient', { senderAddress: sender, recipientAddress: recipient }),
      // Matches every predicate: the sole intersection member.
      baseRecord('intersection', {
        senderAddress: sender,
        recipientAddress: recipient,
        driverAddress: driver,
        status,
      }),
    ]);

    const results = await repository.list({
      senderAddress: sender,
      recipientAddress: recipient,
      driverAddress: driver,
      status,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.chainDeliveryId).toBe(chainId('intersection'));
  });

  it('filters by recipient independently', async () => {
    const recipient = chainId('recipient-only-filter');
    await seed([
      baseRecord('recipient-match', { recipientAddress: recipient }),
      baseRecord('recipient-miss', { recipientAddress: chainId('other-recipient') }),
    ]);

    const results = await repository.list({ recipientAddress: recipient });
    expect(results.map((r) => r.chainDeliveryId)).toEqual([chainId('recipient-match')]);
  });

  it('filters by driver independently and excludes null drivers', async () => {
    const driver = chainId('driver-only-filter');
    await seed([
      baseRecord('driver-match', { driverAddress: driver }),
      baseRecord('driver-miss', { driverAddress: chainId('other-driver') }),
      baseRecord('driver-null', { driverAddress: null }),
    ]);

    const results = await repository.list({ driverAddress: driver });
    expect(results.map((r) => r.chainDeliveryId)).toEqual([chainId('driver-match')]);

    // Unfiltered listing still returns the null-driver row.
    const all = await repository.list({});
    const ids = all.map((r) => r.chainDeliveryId);
    expect(ids).toContain(chainId('driver-null'));
  });

  it('filters by status independently', async () => {
    const status = 'DELIVERED';
    await seed([
      baseRecord('status-match', { status }),
      baseRecord('status-miss', { status: 'CREATED' }),
    ]);

    const results = await repository.list({ status });
    expect(results.map((r) => r.chainDeliveryId)).toEqual([chainId('status-match')]);
  });

  it('orders results by descending createdAtChain', async () => {
    const sender = chainId('ordering-sender');
    await seed([
      baseRecord('order-oldest', {
        senderAddress: sender,
        createdAtChain: new Date('2024-01-01T00:00:00.000Z'),
      }),
      baseRecord('order-newest', {
        senderAddress: sender,
        createdAtChain: new Date('2024-03-01T00:00:00.000Z'),
      }),
      baseRecord('order-middle', {
        senderAddress: sender,
        createdAtChain: new Date('2024-02-01T00:00:00.000Z'),
      }),
    ]);

    const results = await repository.list({ senderAddress: sender });
    expect(results.map((r) => r.chainDeliveryId)).toEqual([
      chainId('order-newest'),
      chainId('order-middle'),
      chainId('order-oldest'),
    ]);
  });
});
