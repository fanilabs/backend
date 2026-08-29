import type { Notification as PrismaNotification, Prisma, PrismaClient } from '@prisma/client';
import type { Notification, NotificationRepository } from '../domain/index.js';

function toDomain(record: PrismaNotification): Notification {
  return {
    id: record.id,
    userId: record.userId,
    channel: record.channel,
    type: record.type,
    payload: record.payload as Record<string, unknown>,
    status: record.status,
    sentAt: record.sentAt,
    createdAt: record.createdAt,
  };
}

export function createPrismaNotificationRepository(prisma: PrismaClient): NotificationRepository {
  return {
    async create(input) {
      const created = await prisma.notification.create({
        data: {
          userId: input.userId,
          channel: input.channel,
          type: input.type,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
      return toDomain(created);
    },

    async findById(id) {
      const record = await prisma.notification.findUnique({ where: { id } });
      return record ? toDomain(record) : null;
    },

    async listByUserId(userId, filter) {
      const records = await prisma.notification.findMany({
        where: {
          userId,
          ...(filter.status && { status: filter.status }),
          ...(filter.before && { createdAt: { lt: filter.before } }),
        },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
      });
      return records.map(toDomain);
    },

    async markSent(id, sentAt) {
      await prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt } });
    },

    async markFailed(id) {
      await prisma.notification.update({ where: { id }, data: { status: 'FAILED' } });
    },
  };
}
