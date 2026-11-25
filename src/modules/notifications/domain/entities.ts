import type { NotificationChannel, NotificationStatus, NotificationEventType } from '@prisma/client';

export type { NotificationChannel, NotificationStatus, NotificationEventType };

export interface Notification {
  id: string;
  userId: string;
  channel: NotificationChannel;
  type: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  readAt: Date | null;
  sentAt: Date | null;
  failureReason: string | null;
  attempts: number;
  createdAt: Date;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  eventType: NotificationEventType;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
