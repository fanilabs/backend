import type { Evidence as PrismaEvidence, PrismaClient } from '@prisma/client';
import type { Evidence, EvidenceRepository } from '../domain/index.js';

function toDomain(record: PrismaEvidence): Evidence {
  return {
    id: record.id,
    disputeId: record.disputeId,
    hash: record.hash,
    storageUrl: record.storageUrl,
    contentType: record.contentType,
    uploadedBy: record.uploadedBy,
    createdAt: record.createdAt,
  };
}

export function createPrismaEvidenceRepository(prisma: PrismaClient): EvidenceRepository {
  return {
    async findById(id) {
      const record = await prisma.evidence.findUnique({ where: { id } });
      return record ? toDomain(record) : null;
    },

    async listByDisputeId(disputeId) {
      const records = await prisma.evidence.findMany({
        where: { disputeId },
        orderBy: { createdAt: 'asc' },
      });
      return records.map(toDomain);
    },

    async create(record) {
      const created = await prisma.evidence.create({
        data: {
          disputeId: record.disputeId,
          hash: record.hash,
          storageUrl: record.storageUrl,
          contentType: record.contentType,
          uploadedBy: record.uploadedBy,
        },
      });
      return toDomain(created);
    },
  };
}
