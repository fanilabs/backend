import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
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

function serializeNotification(notification: Notification) {
  return {
    id: notification.id,
    channel: notification.channel,
    type: notification.type,
    payload: notification.payload,
    status: notification.status,
    sentAt: notification.sentAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

function requireUserId(request: { user?: { id: string } }): string {
  if (!request.user) {
    // Unreachable in practice — both routes below attach `authenticate` as
    // a preHandler, which throws before a handler body ever runs. This
    // exists so `request.user.id` is never accessed through a non-null
    // assertion further down (same pattern as `users/interface/routes.ts`).
    throw new UnauthorizedError('Authentication required');
  }
  return request.user.id;
}

export function createNotificationsRoutes(useCases: NotificationsUseCases): FastifyPluginAsyncZod {
  return async function notificationsRoutes(app) {
    app.get(
      '/notifications',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          querystring: listNotificationsQuerySchema,
          response: { 200: listNotificationsResponseSchema },
        },
      },
      async (request, reply) => {
        const { status, limit } = request.query;
        const notifications = await useCases.listNotifications({
          userId: requireUserId(request),
          ...(status && { status }),
          ...(limit !== undefined && { limit }),
        });
        void reply.status(200).send(ok(notifications.map(serializeNotification)));
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
          userId: requireUserId(request),
          notificationId: request.params.id,
        });
        void reply.status(200).send(ok(serializeNotification(notification)));
      },
    );
  };
}
