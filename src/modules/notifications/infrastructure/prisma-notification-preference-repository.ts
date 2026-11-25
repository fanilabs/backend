import type { PrismaClient } from '@prisma/client';
import type {
  NotificationPreference,
  NotificationPreferenceRepository,
} from '../domain/index.js';
import type { NotificationPreference as PrismaPreference } from '@prisma/client';

function toDomain(record: PrismaPreference): NotificationPreference {
  return {
    id: record.id,
    userId: record.userId,
    eventType: record.eventType,
    disabled: record.disabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createPrismaNotificationPreferenceRepository(
  prisma: PrismaClient,
): NotificationPreferenceRepository {
  return {
    async listByUserId(userId) {
      const records = await prisma.notificationPreference.findMany({
        where: { userId },
        orderBy: { eventType: 'asc' },
      });
      return records.map(toDomain);
    },

    async upsert(input) {
      const record = await prisma.notificationPreference.upsert({
        where: { userId_eventType: { userId: input.userId, eventType: input.eventType } },
        create: {
          userId: input.userId,
          eventType: input.eventType,
          disabled: input.disabled,
        },
        update: { disabled: input.disabled },
      });
      return toDomain(record);
    },

    async isDisabled(userId, eventType) {
      const record = await prisma.notificationPreference.findUnique({
        where: { userId_eventType: { userId, eventType } },
        select: { disabled: true },
      });
      return record?.disabled === true;
    },
  };
}
