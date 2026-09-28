import type { PrismaClient } from '@prisma/client';
import type { DisputeReviewReader } from '../domain/index.js';

export function createPrismaDisputeReviewReader(prisma: PrismaClient): DisputeReviewReader {
  return {
    async listOpenDisputes(filter) {
      const disputes = await prisma.dispute.findMany({
        where: {
          status: 'OPEN',
          ...(filter.after && {
            OR: [
              { raisedAt: { gt: filter.after.raisedAt } },
              {
                raisedAt: filter.after.raisedAt,
                chainDeliveryId: { gt: filter.after.chainDeliveryId },
              },
            ],
          }),
        },
        orderBy: [{ raisedAt: 'asc' }, { chainDeliveryId: 'asc' }],
        take: filter.limit + 1,
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
