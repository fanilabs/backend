import type { DriverProfile as PrismaDriverProfile, PrismaClient } from '@prisma/client';
import type { DriverProfile, DriverProfileRepository } from '../domain/index.js';

function toDomain(record: PrismaDriverProfile): DriverProfile {
  return {
    id: record.id,
    address: record.address,
    reputationScore: record.reputationScore,
    tier: record.tier,
    kycVerified: record.kycVerified,
    deliveriesCompleted: record.deliveriesCompleted,
    legacyDeliveriesCompleted: record.legacyDeliveriesCompleted,
    registeredAt: record.registeredAt,
  };
}

export function createPrismaDriverProfileRepository(prisma: PrismaClient): DriverProfileRepository {
  return {
    async findByAddress(address) {
      const record = await prisma.driverProfile.findUnique({ where: { address } });
      return record ? toDomain(record) : null;
    },

    async upsert(address, fields) {
      const data = {
        reputationScore: fields.reputationScore,
        tier: fields.tier,
        kycVerified: fields.kycVerified,
        deliveriesCompleted: fields.deliveriesCompleted,
        registeredAt: fields.registeredAt,
        ...(fields.legacyDeliveriesCompleted !== undefined && {
          legacyDeliveriesCompleted: fields.legacyDeliveriesCompleted,
        }),
      };
      await prisma.driverProfile.upsert({
        where: { address },
        create: { address, ...data },
        update: data,
      });
    },
  };
}
