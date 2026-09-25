import { z } from 'zod';

/**
 * Mirrors `NotificationChannel`'s full three-variant Prisma enum (previously
 * narrowed to the single `EMAIL` literal per #103 — reverted as part of a
 * later security/correctness review: seed data and any other direct write
 * can and does produce `SMS`/`PUSH` rows — see prisma/seed.ts's `PUSH`/`SMS`
 * fixtures — and a response schema that can't represent a value the
 * database actually holds fails every read of it, turning `GET
 * /notifications`/`GET /notifications/:id` into a 500 for any user who has
 * one. "Persisted channel" and "currently deliverable channel" are
 * deliberately different concepts now: this widened schema honestly
 * reflects the former; `NotificationSender`'s own doc comment (only ever
 * wired for `EMAIL`) and `sendNotification`'s explicit channel check are
 * what actually enforce the latter, at the delivery boundary rather than
 * the read boundary — an SMS/PUSH row is still never sent, just no longer
 * un-readable.
 */
const notificationChannel = z.enum(['EMAIL', 'SMS', 'PUSH']);
const notificationStatus = z.enum(['PENDING', 'SENT', 'FAILED']);

const notificationDto = z.object({
  id: z.string().uuid(),
  channel: notificationChannel,
  type: z.string().max(100),
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
