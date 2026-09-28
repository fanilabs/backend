import { z } from 'zod';

const MAX_ENTITY_TYPE_LENGTH = 100;

const disputeStatus = z.enum(['OPEN', 'RESOLVED_REFUND', 'RESOLVED_PAYOUT', 'SPLIT']);
const userRole = z.enum(['CUSTOMER', 'COURIER', 'FLEET_MANAGER', 'ADMIN']);

const disputeCursor = z
  .string()
  .max(64)
  .refine(
    (cursor) => {
      const separatorIndex = cursor.indexOf('|');
      const chainDeliveryId = cursor.slice(separatorIndex + 1);
      return (
        separatorIndex > 0 &&
        separatorIndex === cursor.lastIndexOf('|') &&
        z.string().datetime().safeParse(cursor.slice(0, separatorIndex)).success &&
        /^(0|[1-9]\d{0,18})$/.test(chainDeliveryId) &&
        BigInt(chainDeliveryId) <= 9_223_372_036_854_775_807n
      );
    },
    { message: 'Invalid dispute cursor' },
  );

export const listOpenDisputesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  after: disputeCursor.optional(),
});
export const listOpenDisputesResponseSchema = z.object({
  data: z.array(
    z.object({
      chainDeliveryId: z.string(),
      status: disputeStatus,
      raisedBy: z.string().max(255),
      raisedAt: z.string().datetime(),
      evidenceCount: z.number().int(),
    }),
  ),
  meta: z.object({
    limit: z.number().int(),
    nextCursor: z.string().nullable(),
  }),
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
      actorLabel: z.string().max(255),
      action: z.string(),
      entityType: z.string().max(MAX_ENTITY_TYPE_LENGTH),
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
