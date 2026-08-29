import type { Prisma, PrismaClient } from '@prisma/client';
import type { EventStore } from '../domain/index.js';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

/**
 * Relies on the `(contractName, network, rpcEventId)` unique constraint
 * (prisma/schema.prisma) to make `tryInsert` idempotent — a duplicate
 * insert attempt is caught and reported as "already there" (`false`)
 * rather than propagated as an error, which is the whole point: re-polling
 * an overlapping ledger range must be a harmless no-op.
 */
export function createPrismaEventStore(prisma: PrismaClient): EventStore {
  return {
    async tryInsert(event) {
      try {
        await prisma.blockchainEvent.create({
          data: {
            contractName: event.contractName,
            network: event.network,
            rpcEventId: event.rpcEventId,
            ledgerSeq: event.ledgerSeq,
            txHash: event.txHash,
            topic: event.topic,
            payload: event.payload as Prisma.InputJsonValue,
            ledgerClosedAt: event.closedAt,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          return false;
        }
        throw error;
      }
    },

    async markProcessed(rpcEventId) {
      await prisma.blockchainEvent.updateMany({
        where: { rpcEventId },
        data: {
          processedAt: new Date(),
        },
      });
    },

    async markFailed(rpcEventId, reason) {
      await prisma.blockchainEvent.updateMany({
        where: { rpcEventId },
        data: {
          processingError: reason,
        },
      });
    },
  };
}
