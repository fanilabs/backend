import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireRole } from '../../../shared/http/index.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import type { AdminUser, AuditLogEntry, DisputeReviewItem } from '../domain/index.js';
import type {
  createListAuditLogUseCase,
  createListOpenDisputesUseCase,
  createUpdateUserRoleUseCase,
} from '../application/index.js';
import {
  listAuditLogQuerySchema,
  listAuditLogResponseSchema,
  listOpenDisputesResponseSchema,
  updateUserRoleBodySchema,
  updateUserRoleResponseSchema,
  userIdParamsSchema,
} from './schemas.js';

export interface AdminUseCases {
  listOpenDisputes: ReturnType<typeof createListOpenDisputesUseCase>;
  updateUserRole: ReturnType<typeof createUpdateUserRoleUseCase>;
  listAuditLog: ReturnType<typeof createListAuditLogUseCase>;
}

function serializeDispute(item: DisputeReviewItem) {
  return {
    chainDeliveryId: item.chainDeliveryId.toString(),
    status: item.status,
    raisedBy: item.raisedBy,
    raisedAt: item.raisedAt.toISOString(),
    evidenceCount: item.evidenceCount,
  };
}

function serializeUser(user: AdminUser) {
  return { id: user.id, email: user.email, role: user.role };
}

function serializeAuditLogEntry(entry: AuditLogEntry) {
  return {
    id: entry.id,
    actorId: entry.actorId,
    actorLabel: entry.actorLabel,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
  };
}

function requireUserId(request: { user?: { id: string } }): string {
  if (!request.user) {
    // Unreachable in practice — every route below attaches `authenticate`
    // as a preHandler, which throws before a handler body ever runs.
    throw new UnauthorizedError('Authentication required');
  }
  return request.user.id;
}

const adminOnly = [authenticate, requireRole('ADMIN')];

export function createAdminRoutes(useCases: AdminUseCases): FastifyPluginAsyncZod {
  return async function adminRoutes(app) {
    app.get(
      '/admin/disputes',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          response: { 200: listOpenDisputesResponseSchema },
        },
      },
      async (_request, reply) => {
        const disputes = await useCases.listOpenDisputes();
        void reply.status(200).send(ok(disputes.map(serializeDispute)));
      },
    );

    app.post(
      '/admin/users/:id/role',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          params: userIdParamsSchema,
          body: updateUserRoleBodySchema,
          response: { 200: updateUserRoleResponseSchema },
        },
      },
      async (request, reply) => {
        const user = await useCases.updateUserRole({
          actorId: requireUserId(request),
          userId: request.params.id,
          role: request.body.role,
        });
        void reply.status(200).send(ok(serializeUser(user)));
      },
    );

    app.get(
      '/admin/audit-log',
      {
        preHandler: adminOnly,
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          querystring: listAuditLogQuerySchema,
          response: { 200: listAuditLogResponseSchema },
        },
      },
      async (request, reply) => {
        const { limit } = request.query;
        const entries = await useCases.listAuditLog({ ...(limit !== undefined && { limit }) });
        void reply.status(200).send(ok(entries.map(serializeAuditLogEntry)));
      },
    );
  };
}
