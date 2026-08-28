import { z } from 'zod';

const notificationChannel = z.enum(['EMAIL', 'SMS', 'PUSH']);
const notificationStatus = z.enum(['PENDING', 'SENT', 'FAILED']);

const notificationDto = z.object({
  id: z.string().uuid(),
  channel: notificationChannel,
  type: z.string(),
  payload: z.record(z.unknown()),
  status: notificationStatus,
  sentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const listNotificationsQuerySchema = z.object({
  status: notificationStatus.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  before: z.string().datetime().optional(),
});
export const listNotificationsResponseSchema = z.object({
  data: z.array(notificationDto),
  meta: z.object({
    limit: z.number().int(),
    nextCursor: z.string().datetime().nullable(),
  }),
});

export const notificationIdParamsSchema = z.object({ id: z.string().uuid() });
export const getNotificationResponseSchema = z.object({ data: notificationDto });
