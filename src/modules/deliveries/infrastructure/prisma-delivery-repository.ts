import type { Delivery as PrismaDelivery, Prisma, PrismaClient } from '@prisma/client';
import type { Delivery, DeliveryRepository } from '../domain/index.js';

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
      await prisma.delivery.update({
        where: { chainDeliveryId },
        data: {
          status: patch.status,
          ...(patch.driverAddress !== undefined && { driverAddress: patch.driverAddress }),
          ...(patch.transitStartedAt !== undefined && { transitStartedAt: patch.transitStartedAt }),
          ...(patch.deliveredAt !== undefined && { deliveredAt: patch.deliveredAt }),
        },
      });
    },
  };
}
