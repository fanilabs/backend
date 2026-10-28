import { processingPolicy, PROCESSING_POLICY_VERSION } from '../domain/processing-policy.js';
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
 * rather than propagated as an error. Admission creates durable blocked
 * requirements atomically. Duplicate receipt never establishes completion,
 * creates legacy completion evidence, or enables replay. The legacy poll/bus
 * path remains separate and is not successful-processing evidence.
 */
export function createPrismaEventStore(prisma: PrismaClient): EventStore {
  return {
    async tryInsert(event) {
      try {
        await prisma.$transaction(async (tx) => {
          const row = await tx.blockchainEvent.create({
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
          const policy = processingPolicy(event.contractName, event.topic);
          await tx.$executeRaw`
          INSERT INTO event_processing_receipts (event_id, policy_version, blocked_reason)
          VALUES (${row.id}, ${PROCESSING_POLICY_VERSION}, ${policy.reason})`;
          for (const consumer of policy.required) {
            await tx.$executeRaw`
            INSERT INTO event_consumer_obligations (event_id, consumer_id, blocked_reason)
            VALUES (${row.id}, ${consumer}, ${policy.reason})`;
          }
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          return false;
        }
        throw error;
      }
    },
  };
}
