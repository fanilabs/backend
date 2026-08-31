import type { DisputeStatus, UserRole } from '@prisma/client';

export type { DisputeStatus, UserRole };

export interface DisputeReviewItem {
  chainDeliveryId: bigint;
  status: DisputeStatus;
  raisedBy: string;
  raisedAt: Date;
  evidenceCount: number;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
