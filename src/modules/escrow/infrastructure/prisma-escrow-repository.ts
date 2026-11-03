import type { Escrow as PrismaEscrow, Prisma, PrismaClient } from '@prisma/client';
import { decimalToBigInt } from '../../../shared/database/index.js';
import type { Escrow, EscrowRepository, EscrowSecondaryOperation } from '../domain/index.js';

export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;
export type PrismaSecondaryOperation = (tx: Prisma.TransactionClient) => Promise<void>;

export const MAX_RETRY_ATTEMPTS = 3;

/** Checks whether a database error indicates a concurrent write conflict (Prisma P2034). */
export function isWriteConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2034'
  );
}

/**
 * Retries an interactive transaction block on transient write conflicts (P2034)
 * with exponential backoff before bubbling up.
 */
export async function executeWithRetry<T>(
  action: () => Promise<T>,
  maxAttempts = MAX_RETRY_ATTEMPTS,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      attempt += 1;
      return await action();
    } catch (error) {
      if (isWriteConflictError(error) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** (attempt - 1)));
        continue;
      }
      throw error;
    }
  }
}

function toDomain(record: PrismaEscrow): Escrow {
  return {
    id: record.id,
    chainDeliveryId: record.chainDeliveryId,
    senderAddress: record.senderAddress,
    recipientAddress: record.recipientAddress,
    driverAddress: record.driverAddress,
    token: record.token,
    amount: decimalToBigInt(record.amount),
    platformFee: record.platformFee === null ? null : decimalToBigInt(record.platformFee),
    status: record.status,
    disputedBy: record.disputedBy,
    disputedAt: record.disputedAt,
    releasedAt: record.releasedAt,
    refundedAt: record.refundedAt,
    createdAtChain: record.createdAtChain,
    isVerified: record.isVerified,
  };
}

export function createPrismaEscrowRepository(prisma: PrismaClientOrTx): EscrowRepository {
  const runTransaction = async <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> => {
    if ('$transaction' in prisma && typeof prisma.$transaction === 'function') {
      return prisma.$transaction(fn);
    }
    return fn(prisma as Prisma.TransactionClient);
  };

  return {
    async findByChainDeliveryId(chainDeliveryId) {
      const record = await prisma.escrow.findUnique({ where: { chainDeliveryId } });
      return record ? toDomain(record) : null;
    },

    async create(record) {
      return executeWithRetry(async () => {
        return runTransaction(async (tx) => {
          const created = await tx.escrow.create({
            data: {
              chainDeliveryId: record.chainDeliveryId,
              senderAddress: record.senderAddress,
              recipientAddress: record.recipientAddress,
              driverAddress: record.driverAddress,
              token: record.token,
              amount: record.amount.toString(),
              status: record.status,
              disputedBy: record.disputedBy,
              disputedAt: record.disputedAt,
              createdAtChain: record.createdAtChain,
              isVerified: record.isVerified ?? false,
            },
          });
          return toDomain(created);
        });
      });
    },

    async updateStatus(chainDeliveryId, patch, secondaryOperation?: EscrowSecondaryOperation) {
      await executeWithRetry(async () => {
        await runTransaction(async (tx) => {
          await tx.escrow.update({
            where: { chainDeliveryId },
            data: {
              status: patch.status,
              ...(patch.platformFee !== undefined && { platformFee: patch.platformFee.toString() }),
              ...(patch.disputedBy !== undefined && { disputedBy: patch.disputedBy }),
              ...(patch.disputedAt !== undefined && { disputedAt: patch.disputedAt }),
              ...(patch.releasedAt !== undefined && { releasedAt: patch.releasedAt }),
              ...(patch.refundedAt !== undefined && { refundedAt: patch.refundedAt }),
            },
          });

          if (secondaryOperation) {
            await secondaryOperation(tx);
          }
        });
      });
    },
  };
}
