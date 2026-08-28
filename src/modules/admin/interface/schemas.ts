import { z } from 'zod';

const disputeStatus = z.enum(['OPEN', 'RESOLVED_REFUND', 'RESOLVED_PAYOUT', 'SPLIT']);
const userRole = z.enum(['CUSTOMER', 'COURIER', 'FLEET_MANAGER', 'ADMIN']);

export const listOpenDisputesResponseSchema = z.object({
  data: z.array(
    z.object({
      chainDeliveryId: z.string(),
      status: disputeStatus,
      raisedBy: z.string(),
      raisedAt: z.string().datetime(),
      evidenceCount: z.number().int(),
    }),
  ),
});

export const userIdParamsSchema = z.object({ id: z.string().uuid() });

export const updateUserRoleBodySchema = z.object({ role: userRole });
export const updateUserRoleResponseSchema = z.object({
  data: z.object({ id: z.string().uuid(), email: z.string(), role: userRole }),
});

export const listAuditLogQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.string().datetime().optional(),
});
export const listAuditLogResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      actorId: z.string().uuid().nullable(),
      actorLabel: z.string(),
      action: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      metadata: z.record(z.unknown()).nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
  meta: z.object({
    limit: z.number().int(),
    nextCursor: z.string().datetime().nullable(),
  }),
});
