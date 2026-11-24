import { randomUUID } from 'node:crypto';
import { testAddress } from '../../../../shared/testing/addresses.js';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  DeliveryParties,
  DeliveryPartyLookup,
  Notification,
  NotificationEventType,
  NotificationJobScheduler,
  NotificationPreference,
  NotificationPreferenceRepository,
  NotificationRepository,
  NotificationSender,
  UserContact,
  UserContactLookup,
} from '../../domain/index.js';

export function createInMemoryNotificationRepository(): NotificationRepository & {
  seed(notification: Notification): void;
  all(): Notification[];
} {
  const notifications = new Map<string, Notification>();

  return {
    seed(notification) {
      notifications.set(notification.id, notification);
    },
    all() {
      return [...notifications.values()];
    },
    async create(input) {
      const notification: Notification = {
        id: randomUUID(),
        userId: input.userId,
        channel: input.channel,
        type: input.type,
        payload: input.payload,
        status: 'PENDING',
        readAt: null,
        sentAt: null,
        failureReason: null,
        attempts: 0,
        createdAt: new Date(),
      };
      notifications.set(notification.id, notification);
      return notification;
    },
    async findById(id) {
      return notifications.get(id) ?? null;
    },
    async listByUserId(userId, filter) {
      let results = [...notifications.values()]
        .filter((n) => n.userId === userId)
        .filter((n) => !filter.status || n.status === filter.status)
        .filter((n) => filter.unread === undefined || (filter.unread ? n.readAt === null : n.readAt !== null))
        .filter((n) => filter.channel === undefined || n.channel === filter.channel)
        // Apply composite cursor: rows older than (cursor.createdAt, cursor.id)
        .filter((n) => {
          if (!filter.cursor) return true;
          const { createdAt, id } = filter.cursor;
          if (n.createdAt.getTime() < createdAt.getTime()) return true;
          if (n.createdAt.getTime() === createdAt.getTime() && n.id < id) return true;
          return false;
        })
        .sort((a, b) => {
          const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
          if (timeDiff !== 0) return timeDiff;
          return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
        });

      return results.slice(0, filter.limit);
    },
    async markAllRead(userId) {
      const readAt = new Date();
      let count = 0;
      for (const [id, notification] of notifications) {
        if (notification.userId === userId && notification.readAt === null) {
          notifications.set(id, { ...notification, readAt });
          count += 1;
        }
      }
      return count;
    },
    async markSent(id, sentAt) {
      const existing = notifications.get(id);
      if (!existing) return;
      notifications.set(id, { ...existing, status: 'SENT', sentAt });
    },
    async markFailed(id: string, reason?: string) {
      const existing = notifications.get(id);
      if (!existing) return;
      notifications.set(id, {
        ...existing,
        status: 'FAILED',
        failureReason: reason ?? null,
        attempts: existing.attempts + 1,
      });
    },
  };
}

export function createFakeUserContactLookup(): UserContactLookup & {
  seedAddress(address: string, contact: UserContact): void;
  seedUserId(userId: string, contact: UserContact): void;
} {
  const byAddress = new Map<string, UserContact>();
  const byUserId = new Map<string, UserContact>();

  return {
    seedAddress(address, contact) {
      byAddress.set(address, contact);
    },
    seedUserId(userId, contact) {
      byUserId.set(userId, contact);
    },
    async findByWalletAddress(address) {
      return byAddress.get(address) ?? null;
    },
    async findByUserId(userId) {
      return byUserId.get(userId) ?? null;
    },
  };
}

export function createFakeNotificationSender(): NotificationSender & {
  sent: Array<{ to: string; type: string; payload: Record<string, unknown> }>;
  failNext(): void;
} {
  const sent: Array<{ to: string; type: string; payload: Record<string, unknown> }> = [];
  let shouldFail = false;

  return {
    sent,
    failNext() {
      shouldFail = true;
    },
    async send(input) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('Simulated send failure');
      }
      sent.push(input);
    },
  };
}

export function createFakeNotificationJobScheduler(): NotificationJobScheduler & {
  enqueued: string[];
} {
  const enqueued: string[] = [];
  return {
    enqueued,
    async enqueueDelivery(notificationId) {
      enqueued.push(notificationId);
    },
  };
}

export function createFakeDeliveryPartyLookup(): DeliveryPartyLookup & {
  seedParties(chainDeliveryId: string, parties: DeliveryParties): void;
} {
  const byDeliveryId = new Map<string, DeliveryParties>();

  return {
    seedParties(chainDeliveryId, parties) {
      byDeliveryId.set(chainDeliveryId, parties);
    },
    async findParties(chainDeliveryId) {
      return byDeliveryId.get(chainDeliveryId) ?? null;
    },
  };
}

export function createFakeNotificationPreferenceRepository(): NotificationPreferenceRepository & {
  seedPreference(pref: NotificationPreference): void;
} {
  const preferences = new Map<string, NotificationPreference>();

  function key(userId: string, eventType: NotificationEventType): string {
    return `${userId}:${eventType}`;
  }

  const now = new Date();

  return {
    seedPreference(pref) {
      preferences.set(key(pref.userId, pref.eventType), pref);
    },
    async listByUserId(userId) {
      return [...preferences.values()].filter((p) => p.userId === userId);
    },
    async upsert(input) {
      const k = key(input.userId, input.eventType);
      const existing = preferences.get(k);
      const updated: NotificationPreference = existing
        ? { ...existing, disabled: input.disabled, updatedAt: new Date() }
        : {
            id: randomUUID(),
            userId: input.userId,
            eventType: input.eventType,
            disabled: input.disabled,
            createdAt: now,
            updatedAt: now,
          };
      preferences.set(k, updated);
      return updated;
    },
    async isDisabled(userId, eventType) {
      const pref = preferences.get(key(userId, eventType));
      return pref?.disabled === true;
    },
  };
}

export function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    channel: 'EMAIL',
    type: 'delivery.driver_assigned',
    payload: {},
    status: 'PENDING',
    readAt: null,
    sentAt: null,
    failureReason: null,
    attempts: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function buildBlockchainEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'delivery',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['driver_assigned'],
    payload: ['1', testAddress('driver')],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
