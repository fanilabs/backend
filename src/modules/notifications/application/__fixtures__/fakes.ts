import { randomUUID } from 'node:crypto';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  Notification,
  NotificationJobScheduler,
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
        sentAt: null,
        createdAt: new Date(),
      };
      notifications.set(notification.id, notification);
      return notification;
    },
    async findById(id) {
      return notifications.get(id) ?? null;
    },
    async listByUserId(userId, filter) {
      return [...notifications.values()]
        .filter((n) => n.userId === userId)
        .filter((n) => !filter.status || n.status === filter.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit);
    },
    async markSent(id, sentAt) {
      const existing = notifications.get(id);
      if (!existing) return;
      notifications.set(id, { ...existing, status: 'SENT', sentAt });
    },
    async markFailed(id) {
      const existing = notifications.get(id);
      if (!existing) return;
      notifications.set(id, { ...existing, status: 'FAILED' });
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

export function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    channel: 'EMAIL',
    type: 'delivery.driver_assigned',
    payload: {},
    status: 'PENDING',
    sentAt: null,
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
    payload: ['1', 'GDRIVER'],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
