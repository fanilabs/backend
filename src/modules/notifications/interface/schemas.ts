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

/**
 * All event types the dispatch use case can generate a notification for.
 * Mirrors `NotificationEventType` in prisma/schema.prisma — keep in sync
 * when new event types are added (#698).
 */
export const notificationEventTypeSchema = z.enum([
  'DELIVERY_DRIVER_ASSIGNED',
  'DELIVERY_IN_TRANSIT',
  'DELIVERY_CONFIRMED',
  'DELIVERY_CANCELLED',
  'ESCROW_DELIVERY_DISPUTED',
  'ESCROW_RELEASED',
  'ESCROW_REFUNDED',
  'DISPUTE_RAISED',
  'DISPUTE_RESOLVED_REFUND',
  'DISPUTE_RESOLVED_SPLIT',
  'DISPUTE_RESOLVED_PAYOUT',
  'REPUTATION_DRIVER_REGISTERED',
  'REPUTATION_KYC_STATUS_UPDATED',
  'REPUTATION_INCREASED',
  'REPUTATION_DECREASED',
  'FLEET_REGISTERED',
  'FLEET_DRIVER_INVITED',
  'FLEET_INVITE_ACCEPTED',
  'FLEET_DRIVER_REMOVED',
]);

const notificationDto = z.object({
  id: z.string().uuid(),
  channel: notificationChannel,
  type: z.string().max(100),
  payload: z.record(z.unknown()),
  status: notificationStatus,
  readAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const listNotificationsQuerySchema = z.object({
  status: notificationStatus.optional(),
  /** `true` = only unread rows (readAt is null); `false` = only read rows.
   * Omitting the parameter returns all rows regardless of read state. */
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** When present, only notifications from this channel are returned. */
  channel: notificationChannel.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  /** Opaque composite cursor from the previous page's `nextCursor` (#695).
   * Do not construct this value yourself — always use the value returned
   * by the previous page response. */
  before: z.string().optional(),
});
export const listNotificationsResponseSchema = z.object({
  data: z.array(notificationDto),
  meta: z.object({
    limit: z.number().int(),
    nextCursor: z.string().nullable(),
  }),
});

export const notificationIdParamsSchema = z.object({ id: z.string().uuid() });
export const getNotificationResponseSchema = z.object({ data: notificationDto });
export const markNotificationsReadResponseSchema = z.object({
  data: z.object({ count: z.number().int().nonnegative() }),
});

/** Preference DTO used in GET and PATCH /notifications/preferences responses. */
export const notificationPreferenceDto = z.object({
  eventType: notificationEventTypeSchema,
  disabled: z.boolean(),
});

/** PATCH /notifications/preferences body — a partial map of eventType → disabled. */
export const updateNotificationPreferencesBodySchema = z.object({
  preferences: z
    .array(
      z.object({
        eventType: notificationEventTypeSchema,
        disabled: z.boolean(),
      }),
    )
    .min(1),
});

export const notificationPreferencesResponseSchema = z.object({
  data: z.array(notificationPreferenceDto),
});
