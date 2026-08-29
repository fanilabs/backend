import { z } from 'zod';

/**
 * Deliberately narrower than `NotificationChannel`'s three Prisma enum
 * variants (see #103): `dispatchNotificationsFromEvent` only ever produces
 * `EMAIL` rows, and `LoggerNotificationSender`/any future real sender is
 * email-shaped by construction — SMS/PUSH are reachable in the database
 * enum (kept for forward compatibility once a real multi-channel sender
 * exists) but were never reachable through this API, so the response
 * contract is narrowed to match what the system can actually produce
 * rather than advertising values it can never return.
 */
const notificationChannel = z.literal('EMAIL');
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
