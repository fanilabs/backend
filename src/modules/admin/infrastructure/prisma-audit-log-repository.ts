import type { AuditLog as PrismaAuditLog, Prisma } from '@prisma/client';
import type { AuditLogEntry, AuditLogRepository } from '../domain/index.js';

function toDomain(record: PrismaAuditLog): AuditLogEntry {
  return {
    id: record.id,
    actorId: record.actorId,
    actorLabel: record.actorLabel,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    metadata: (record.metadata as Record<string, unknown> | null) ?? null,
    createdAt: record.createdAt,
  };
}

export function createPrismaAuditLogRepository(
  prisma: Prisma.TransactionClient,
): AuditLogRepository {
  return {
    async record(input) {
      await prisma.auditLog.create({
        data: {
          actorId: input.actorId,
          actorLabel: input.actorLabel,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          ...(input.metadata !== undefined && {
            metadata: input.metadata as Prisma.InputJsonValue,
          }),
        },
      });
    },

    async list(filter) {
      const where: Record<string, unknown> = {};
      if (filter.actorId) where.actorId = filter.actorId;
      if (filter.action) where.action = filter.action;

      const records = await prisma.auditLog.findMany({
        ...(filter.before && { cursor: { id: filter.before }, skip: 1 }),
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filter.limit,
      });
      return records.map(toDomain);
    },

    async count(filter) {
      const where: Record<string, unknown> = {};
      if (filter.actorId) where.actorId = filter.actorId;
      if (filter.action) where.action = filter.action;
      return prisma.auditLog.count({ where });
    },
  };
}
