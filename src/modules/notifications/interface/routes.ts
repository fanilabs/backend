import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireUser } from '../../../shared/http/index.js';
import type { Notification } from '../domain/index.js';
import type {
  createGetNotificationUseCase,
  createListNotificationsUseCase,
} from '../application/index.js';
import {
  getNotificationResponseSchema,
  listNotificationsQuerySchema,
  listNotificationsResponseSchema,
  notificationIdParamsSchema,
} from './schemas.js';

export interface NotificationsUseCases {
  listNotifications: ReturnType<typeof createListNotificationsUseCase>;
  getNotification: ReturnType<typeof createGetNotificationUseCase>;
}

const REDACTED_PAYLOAD_KEYS = new Set([
  'userId',
  'internalId',
  'email',
  'passwordHash',
  'token',
  'stack',
]);

export function sanitizeNotificationPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!REDACTED_PAYLOAD_KEYS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function serializeNotification(notification: Notification) {
  return {
    id: notification.id,
    // `notification.channel` is the column's real 3-variant Prisma enum
    // value, and the response schema now mirrors it exactly (see
    // `interface/schemas.ts`'s doc comment) — a persisted SMS/PUSH row
    // (seed data, or any other direct write) serializes successfully
    // instead of failing this route's Zod response validation. Whether a
    // channel can actually be *sent* is a separate question this response
    // makes no claim about — see `sendNotification`'s explicit channel
    // check and `NotificationSender`'s doc comment.
    channel: notification.channel,
    type: notification.type,
    payload: sanitizeNotificationPayload(notification.payload),
    status: notification.status,
    sentAt: notification.sentAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function createNotificationsRoutes(useCases: NotificationsUseCases): FastifyPluginAsyncZod {
  return async function notificationsRoutes(app) {
    app.get(
      '/notifications',
      {
        onRequest: [authenticate],
        schema: {
          security: [{ bearerAuth: [] }],
          querystring: listNotificationsQuerySchema,
          response: { 200: listNotificationsResponseSchema },
        },
      },
      async (request, reply) => {
        const { status, limit, before } = request.query;
        const {
          items,
          nextCursor,
          limit: appliedLimit,
        } = await useCases.listNotifications({
          userId: requireUser(request).id,
          ...(status && { status }),
          ...(limit !== undefined && { limit }),
          ...(before !== undefined && { before }),
        });
        void reply
          .status(200)
          .send(ok(items.map(serializeNotification), { limit: appliedLimit, nextCursor }));
      },
    );

    app.get(
      '/notifications/:id',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          params: notificationIdParamsSchema,
          response: { 200: getNotificationResponseSchema },
        },
      },
      async (request, reply) => {
        const notification = await useCases.getNotification({
          userId: requireUser(request).id,
          notificationId: request.params.id,
        });
        void reply.status(200).send(ok(serializeNotification(notification)));
      },
    );
  };
}
