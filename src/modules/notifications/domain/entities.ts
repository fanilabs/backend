import type { NotificationChannel, NotificationStatus } from '@prisma/client';

export type { NotificationChannel, NotificationStatus };

export interface Notification {
  id: string;
  userId: string;
  channel: NotificationChannel;
  type: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  sentAt: Date | null;
  createdAt: Date;
}
