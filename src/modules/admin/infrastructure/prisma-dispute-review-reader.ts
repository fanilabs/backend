import type { PrismaClient } from '@prisma/client';
import type { DisputeReviewReader } from '../domain/index.js';

export function createPrismaDisputeReviewReader(prisma: PrismaClient): DisputeReviewReader {
  return {
    async listOpenDisputes() {
      const disputes = await prisma.dispute.findMany({
        where: { status: 'OPEN' },
        orderBy: { raisedAt: 'asc' },
        include: { _count: { select: { evidence: true } } },
      });
      return disputes.map((dispute) => ({
        chainDeliveryId: dispute.chainDeliveryId,
        status: dispute.status,
        raisedBy: dispute.raisedBy,
        raisedAt: dispute.raisedAt,
        evidenceCount: dispute._count.evidence,
      }));
    },
  };
}
