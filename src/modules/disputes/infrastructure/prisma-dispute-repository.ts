import type { Dispute as PrismaDispute, PrismaClient } from '@prisma/client';
import type { Dispute, DisputeRepository } from '../domain/index.js';

function toDomain(record: PrismaDispute): Dispute {
  return {
    id: record.id,
    chainDeliveryId: record.chainDeliveryId,
    status: record.status,
    raisedBy: record.raisedBy,
    raisedAt: record.raisedAt,
    raisedByUserId: record.raisedByUserId,
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
        ...(fields.senderShareBps !== undefined && { senderShareBps: fields.senderShareBps }),
      };
      await prisma.dispute.upsert({
        where: { chainDeliveryId },
        // `raisedByUserId` deliberately only ever appears in `create`, never
        // in `update` — see `DisputeRepository.upsert`'s doc comment for why
        // this repository, not just its callers, is responsible for making
        // sure an already-set value can never be reassigned by a later
        // event (replay, resolution, or otherwise) touching the same row.
        create: {
          chainDeliveryId,
          ...data,
          ...(fields.raisedByUserId !== undefined && { raisedByUserId: fields.raisedByUserId }),
        },
        update: data,
      });
    },

    async recordProposedSenderShareBps(chainDeliveryId, senderShareBps) {
      // updateMany (not update): the dispute row is expected to already
      // exist — resolve_dispute_split_funds is only ever callable on-chain
      // once a dispute is raised and Paused — but this is a best-effort
      // pre-confirmation hint, not the authoritative write (see the port's
      // doc comment), so a missing row here must never throw/fail the
      // caller's request for an unsigned transaction that is otherwise
      // valid to build. The `status: 'OPEN'` filter makes the "never
      // overwrite a confirmed resolution" rule atomic rather than a
      // separate read-then-write that could race with the real sync.
      await prisma.dispute.updateMany({
        where: { chainDeliveryId, status: 'OPEN' },
        data: { senderShareBps },
      });
    },
  };
}
