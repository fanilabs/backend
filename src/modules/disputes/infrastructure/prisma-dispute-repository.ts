import type { Dispute as PrismaDispute, PrismaClient } from '@prisma/client';
import type { Dispute, DisputeRepository } from '../domain/index.js';

function toDomain(record: PrismaDispute): Dispute {
  return {
    id: record.id,
    chainDeliveryId: record.chainDeliveryId,
    status: record.status,
    raisedBy: record.raisedBy,
    raisedAt: record.raisedAt,
    resolvedBy: record.resolvedBy,
    resolvedAt: record.resolvedAt,
    senderShareBps: record.senderShareBps,
  };
}

export function createPrismaDisputeRepository(prisma: PrismaClient): DisputeRepository {
  return {
    async findByChainDeliveryId(chainDeliveryId) {
      const record = await prisma.dispute.findUnique({ where: { chainDeliveryId } });
      return record ? toDomain(record) : null;
    },

    async findById(id) {
      const record = await prisma.dispute.findUnique({ where: { id } });
      return record ? toDomain(record) : null;
    },

    async upsert(chainDeliveryId, fields) {
      const data = {
        status: fields.status,
        raisedBy: fields.raisedBy,
        raisedAt: fields.raisedAt,
        ...(fields.resolvedBy !== undefined && { resolvedBy: fields.resolvedBy }),
        ...(fields.resolvedAt !== undefined && { resolvedAt: fields.resolvedAt }),
      };
      await prisma.dispute.upsert({
        where: { chainDeliveryId },
        create: { chainDeliveryId, ...data },
        update: data,
      });
    },
  };
}
