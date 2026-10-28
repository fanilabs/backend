import type { Delivery as PrismaDelivery, Prisma, PrismaClient } from '@prisma/client';
import type { Delivery, DeliveryRepository } from '../domain/index.js';
import { DeliveryNotFoundError } from '../domain/errors.js';

/**
 * Transient PostgreSQL connection errors (pooler reset, RDS failover,
 * dropped socket) that a short retry with backoff can recover from.
 * Prisma surfaces these as runtime request errors with connection-related
 * messages rather than a stable error code, so match on the message.
 */
const TRANSIENT_ERROR =
  /conn(?:ect|ection)?(?:\s+(?:reset|refused|timeout|closed|terminated|lost|broken))?|server closed the connection unexpectedly|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i;

/** Maximum update attempts (first try + retries) before giving up. */
const MAX_UPDATE_ATTEMPTS = 3;
/** Base backoff between attempts, multiplied by attempt number. */
const RETRY_BACKOFF_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_ERROR.test(error.message);
}

/**
 * Runs a database operation, retrying only on transient connection errors so
 * read-after-write event updates survive pooler resets and failovers instead
 * of being dropped (#379). Non-transient errors (e.g. P2025 record-not-found,
 * constraint violations) propagate immediately.
 */
async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === MAX_UPDATE_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  throw lastError;
}

function toDomain(record: PrismaDelivery): Delivery {
  return {
    id: record.id,
    chainDeliveryId: record.chainDeliveryId,
    senderAddress: record.senderAddress,
    recipientAddress: record.recipientAddress,
    driverAddress: record.driverAddress,
    status: record.status,
    origin: record.origin,
    destination: record.destination,
    cargoCategory: record.cargoCategory,
    weightGrams: record.weightGrams,
    fragile: record.fragile,
    createdAtChain: record.createdAtChain,
    transitStartedAt: record.transitStartedAt,
    deliveredAt: record.deliveredAt,
  };
}

export function createPrismaDeliveryRepository(prisma: PrismaClient): DeliveryRepository {
  return createRepository(prisma, withTransientRetry);
}

/** Uses exactly the caller's transaction client. A failed transaction is not
 * retried internally: the caller must retry the entire effect/completion unit.
 */
export function createTransactionalDeliveryRepository(
  tx: Prisma.TransactionClient,
): DeliveryRepository {
  return createRepository(tx, (operation) => operation());
}

function createRepository(
  prisma: Prisma.TransactionClient,
  updateOperation: <T>(operation: () => Promise<T>) => Promise<T>,
): DeliveryRepository {
  return {
    async findByChainId(chainDeliveryId) {
      const record = await prisma.delivery.findUnique({ where: { chainDeliveryId } });
      return record ? toDomain(record) : null;
    },

    async list(filter) {
      const where: Prisma.DeliveryWhereInput = {
        ...(filter.senderAddress && { senderAddress: filter.senderAddress }),
        ...(filter.recipientAddress && { recipientAddress: filter.recipientAddress }),
        ...(filter.driverAddress && { driverAddress: filter.driverAddress }),
        ...(filter.status && { status: filter.status }),
      };
      const records = await prisma.delivery.findMany({
        where,
        orderBy: { createdAtChain: 'desc' },
      });
      return records.map(toDomain);
    },

    async create(record) {
      const created = await prisma.delivery.create({
        data: {
          chainDeliveryId: record.chainDeliveryId,
          senderAddress: record.senderAddress,
          recipientAddress: record.recipientAddress,
          driverAddress: record.driverAddress,
          status: record.status,
          origin: record.origin,
          destination: record.destination,
          cargoCategory: record.cargoCategory,
          weightGrams: record.weightGrams,
          fragile: record.fragile,
          createdAtChain: record.createdAtChain,
          transitStartedAt: record.transitStartedAt,
          deliveredAt: record.deliveredAt,
        },
      });
      return toDomain(created);
    },

    async updateStatus(chainDeliveryId, patch) {
      await updateOperation(async () => {
        const existing = await prisma.delivery.findUnique({ where: { chainDeliveryId } });
        if (!existing) throw new DeliveryNotFoundError();

        const sameDate = (a: Date | null, b: Date | null): boolean =>
          (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());

        const data: Prisma.DeliveryUpdateInput = {};
        if (patch.status !== existing.status) data.status = patch.status;
        if (patch.driverAddress !== undefined && patch.driverAddress !== existing.driverAddress) {
          data.driverAddress = patch.driverAddress;
        }
        if (
          patch.transitStartedAt !== undefined &&
          !sameDate(patch.transitStartedAt, existing.transitStartedAt)
        ) {
          data.transitStartedAt = patch.transitStartedAt;
        }
        if (patch.deliveredAt !== undefined && !sameDate(patch.deliveredAt, existing.deliveredAt)) {
          data.deliveredAt = patch.deliveredAt;
        }

        // Idempotent no-op: duplicate event deliveries whose status (and any
        // carried timestamps/driver) is already current skip the write
        // instead of rewriting the row.
        if (Object.keys(data).length === 0) return;

        await prisma.delivery.update({ where: { chainDeliveryId }, data });
      });
    },
  };
}
