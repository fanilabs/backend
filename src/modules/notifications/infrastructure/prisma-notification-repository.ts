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
    readAt: record.readAt,
    sentAt: record.sentAt,
    failureReason: record.failureReason,
    attempts: record.attempts,
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
      // Issue #695: composite (createdAt DESC, id DESC) keyset cursor so
      // timestamp ties never cause rows to be skipped at a page boundary.
      // The predicate mirrors the Prisma cursor syntax: rows are "before"
      // the cursor when they sort lower under (createdAt DESC, id DESC),
      // i.e. createdAt < cursor.createdAt OR
      //      (createdAt = cursor.createdAt AND id < cursor.id).
      const cursorWhere: Prisma.NotificationWhereInput | undefined = filter.cursor
        ? {
            OR: [
              { createdAt: { lt: filter.cursor.createdAt } },
              {
                createdAt: { equals: filter.cursor.createdAt },
                id: { lt: filter.cursor.id },
              },
            ],
          }
        : undefined;

      const records = await prisma.notification.findMany({
        where: {
          userId,
          ...(filter.status && { status: filter.status }),
          ...(filter.unread === true && { readAt: null }),
          ...(filter.unread === false && { readAt: { not: null } }),
          ...(filter.channel !== undefined && { channel: filter.channel }),
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filter.limit,
      });
      return records.map(toDomain);
    },

    async markAllRead(userId) {
      const result = await prisma.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
      return result.count;
    },

    async markSent(id, sentAt) {
      await prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt } });
    },

    async markFailed(id, reason) {
      await prisma.notification.update({
        where: { id },
        data: { status: 'FAILED', failureReason: reason ?? null, attempts: { increment: 1 } },
      });
    },
  };
}
