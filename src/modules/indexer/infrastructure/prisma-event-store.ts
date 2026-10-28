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
          if (event.contractId !== undefined) {
            await tx.$executeRaw`
              INSERT INTO event_contract_observations (event_id, contract_id) VALUES (${row.id}, ${event.contractId})`;
          }
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
          // Never overwrite original observation or fabricate it for legacy rows.
          if (event.contractId !== undefined) {
            const existing = await prisma.$queryRaw<Array<{ contract_id: string }>>`
              SELECT o.contract_id FROM event_contract_observations o
              JOIN blockchain_events e ON e.id = o.event_id
              WHERE e.contract_name = ${event.contractName} AND e.network = ${event.network}
                AND e.rpc_event_id = ${event.rpcEventId}`;
            if (existing[0] && existing[0].contract_id !== event.contractId) {
              throw new Error('Conflicting contract identity for duplicate event');
            }
          }
          return false;
        }
        throw error;
      }
    },
  };
}
