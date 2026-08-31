import { randomUUID } from 'node:crypto';
import type {
  AdminUser,
  AuditLogEntry,
  AuditLogRepository,
  DisputeReviewItem,
  DisputeReviewReader,
  UserRoleRepository,
} from '../../domain/index.js';

export interface SessionRevoker {
  revokeAllForUser(userId: string): Promise<void>;
}

export function createFakeDisputeReviewReader(): DisputeReviewReader & {
  seed(items: DisputeReviewItem[]): void;
} {
  let items: DisputeReviewItem[] = [];
  return {
    seed(value) {
      items = value;
    },
    async listOpenDisputes() {
      return items;
    },
  };
}

export function createInMemoryUserRoleRepository(): UserRoleRepository & {
  seed(user: AdminUser): void;
} {
  const users = new Map<string, AdminUser>();
  return {
    seed(user) {
      users.set(user.id, user);
    },
    async findById(userId) {
      return users.get(userId) ?? null;
    },
    async updateRole(userId, role) {
      const existing = users.get(userId);
      if (!existing) return;
      users.set(userId, { ...existing, role });
    },
    async countByRole(role) {
      let count = 0;
      for (const user of users.values()) {
        if (user.role === role) count++;
      }
      return count;
    },
  };
}

export function createInMemoryAuditLogRepository(): AuditLogRepository & {
  all(): AuditLogEntry[];
} {
  const entries: AuditLogEntry[] = [];
  return {
    all() {
      return entries;
    },
    async record(input) {
      entries.unshift({
        id: randomUUID(),
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? null,
        createdAt: new Date(),
      });
    },
    async list(limit) {
      return entries.slice(0, limit);
    },
  };
}

export function buildDisputeReviewItem(
  overrides: Partial<DisputeReviewItem> = {},
): DisputeReviewItem {
  return {
    chainDeliveryId: 1n,
    status: 'OPEN',
    raisedBy: 'GRAISER',
    raisedAt: new Date('2026-01-01T00:00:00Z'),
    evidenceCount: 0,
    ...overrides,
  };
}

export function buildAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: randomUUID(),
    email: 'user@example.com',
    role: 'CUSTOMER',
    ...overrides,
  };
}

export function createFakeSessionRevoker(): SessionRevoker & {
  wasCalledFor(userId: string): boolean;
  allRevoked(): string[];
} {
  const revokedUserIds: string[] = [];
  return {
    wasCalledFor(userId) {
      return revokedUserIds.includes(userId);
    },
    allRevoked() {
      return revokedUserIds;
    },
    async revokeAllForUser(userId) {
      if (!revokedUserIds.includes(userId)) {
        revokedUserIds.push(userId);
      }
    },
  };
}
