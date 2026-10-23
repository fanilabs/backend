import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaNotificationRepository } from './prisma-notification-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma notification repository (integration)', () => {
  const prisma = new PrismaClient();
  const notificationRepository = createPrismaNotificationRepository(prisma);
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `test-${randomUUID()}@example.com`,
        passwordHash: 'hash',
        role: 'CUSTOMER',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  it('creates a notification, round-tripping the JSON payload', async () => {
    const userId = await seedUser();

    const created = await notificationRepository.create({
      userId,
      channel: 'EMAIL',
      type: 'delivery.driver_assigned',
      payload: { chainDeliveryId: '42' },
    });

    expect(created).toMatchObject({
      userId,
      channel: 'EMAIL',
      type: 'delivery.driver_assigned',
      status: 'PENDING',
      payload: { chainDeliveryId: '42' },
      failureReason: null,
      attempts: 0,
    });
    expect(await notificationRepository.findById(created.id)).toMatchObject({ id: created.id });
  });

  it('markSent/markFailed update status (and sentAt for markSent)', async () => {
    const userId = await seedUser();
    const created = await notificationRepository.create({
      userId,
      channel: 'EMAIL',
      type: 'fleet.driver_invited',
      payload: {},
    });

    const sentAt = new Date('2026-01-01T00:00:00Z');
    await notificationRepository.markSent(created.id, sentAt);
    expect(await notificationRepository.findById(created.id)).toMatchObject({
      status: 'SENT',
      sentAt,
    });

    const other = await notificationRepository.create({
      userId,
      channel: 'EMAIL',
      type: 'fleet.driver_removed',
      payload: {},
    });
    await notificationRepository.markFailed(other.id);
    await notificationRepository.markFailed(other.id, 'Invalid SMTP address');
    expect(await notificationRepository.findById(other.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'Invalid SMTP address',
      attempts: 1,
    });
  });

  it("marks only the user's unread notifications as read and returns the count", async () => {
    const userId = await seedUser();
    const otherUserId = await seedUser();
    const unread = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        notificationRepository.create({
          userId,
          channel: 'EMAIL',
          type: `unread-${index}`,
          payload: {},
        }),
      ),
    );
    const alreadyRead = await notificationRepository.create({
      userId,
      channel: 'EMAIL',
      type: 'already-read',
      payload: {},
    });
    const otherUserNotification = await notificationRepository.create({
      userId: otherUserId,
      channel: 'EMAIL',
      type: 'other-user',
      payload: {},
    });
    await prisma.notification.update({
      where: { id: alreadyRead.id },
      data: { readAt: new Date('2026-01-01T00:00:00Z') },
    });

    expect(await notificationRepository.markAllRead(userId)).toBe(5);
    const listed = await notificationRepository.listByUserId(userId, { limit: 10 });
    expect(unread.every(({ id }) => listed.find((notification) => notification.id === id)?.readAt))
      .toBe(true);
    expect(listed.find(({ id }) => id === alreadyRead.id)?.readAt).toEqual(
      new Date('2026-01-01T00:00:00Z'),
    );
    expect((await notificationRepository.findById(otherUserNotification.id))?.readAt).toBeNull();
    expect(await notificationRepository.markAllRead(userId)).toBe(0);
  });

  it('listByUserId filters by status, orders newest first, and respects limit', async () => {
    const userId = await seedUser();
    const first = await notificationRepository.create({
      userId,
      channel: 'EMAIL',
      type: 'a',
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await notificationRepository.create({
      userId,
      channel: 'EMAIL',
      type: 'b',
      payload: {},
    });
    await notificationRepository.markSent(first.id, new Date());

    const sentOnly = await notificationRepository.listByUserId(userId, {
      status: 'SENT',
      limit: 10,
    });
    expect(sentOnly).toHaveLength(1);
    expect(sentOnly[0]?.id).toBe(first.id);

    const all = await notificationRepository.listByUserId(userId, { limit: 10 });
    expect(all.map((n) => n.id)).toEqual([second.id, first.id]);

    const limited = await notificationRepository.listByUserId(userId, { limit: 1 });
    expect(limited).toHaveLength(1);
  });
});
