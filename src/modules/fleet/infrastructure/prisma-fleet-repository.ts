import type {
  Fleet as PrismaFleet,
  FleetDriver as PrismaFleetDriver,
  PrismaClient,
} from '@prisma/client';
import type { Fleet, FleetDriver, FleetRepository, FleetWithDrivers } from '../domain/index.js';

function toDriver(record: PrismaFleetDriver): FleetDriver {
  return {
    id: record.id,
    driverAddress: record.driverAddress,
    status: record.status,
    invitedAt: record.invitedAt,
    acceptedAt: record.acceptedAt,
    removedAt: record.removedAt,
  };
}

function toFleet(record: PrismaFleet): Fleet {
  return {
    id: record.id,
    chainFleetId: record.chainFleetId,
    ownerAddress: record.ownerAddress,
    treasuryAddress: record.treasuryAddress,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toFleetWithDrivers(
  record: PrismaFleet & { drivers: PrismaFleetDriver[] },
  totalActiveDrivers: number,
): FleetWithDrivers {
  return {
    ...toFleet(record),
    drivers: record.drivers.map(toDriver),
    totalActiveDrivers,
  };
}

/**
 * `FleetDriver.fleetId` is the local `Fleet.id`, not the on-chain
 * `chainFleetId` every port method receives — driver-scoped methods resolve
 * the local fleet row first, same rationale as `FleetRepository`'s own
 * header comment in domain/ports.ts.
 */
export function createPrismaFleetRepository(prisma: PrismaClient): FleetRepository {
  return {
    async findByChainFleetId(chainFleetId, options) {
      const includeRemoved = options?.includeRemoved ?? false;
      const driverLimit = options?.driverLimit ?? 100;

      const record = await prisma.fleet.findUnique({
        where: { chainFleetId },
        include: {
          // Filtered — and bounded — in the query itself, not in memory:
          // an unfiltered `include` returns every driver ever associated
          // with the fleet, unbounded by its churn history.
          drivers: {
            where: includeRemoved ? undefined : { removedAt: null },
            take: driverLimit,
            orderBy: { invitedAt: 'desc' },
          },
        },
      });
      if (!record) return null;

      // Always computed from the full, unfiltered membership — must stay
      // correct regardless of whether `drivers` above was filtered or
      // truncated for the response.
      const totalActiveDrivers = await prisma.fleetDriver.count({
        where: { fleetId: record.id, status: 'ACTIVE', removedAt: null },
      });

      return toFleetWithDrivers(record, totalActiveDrivers);
    },

    async create(record) {
      const created = await prisma.fleet.create({
        data: {
          chainFleetId: record.chainFleetId,
          ownerAddress: record.ownerAddress,
          treasuryAddress: record.treasuryAddress,
        },
      });
      return toFleet(created);
    },

    async updateTreasury(chainFleetId, treasuryAddress) {
      await prisma.fleet.update({ where: { chainFleetId }, data: { treasuryAddress } });
    },

    async inviteDriver(chainFleetId, driverAddress, invitedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) return;

      // `upsert`, not `create`: a driver removed from the fleet earlier keeps
      // its row (soft delete) under the same (fleetId, driverAddress) unique
      // key, so a later re-invite must reset that row rather than violate
      // the constraint trying to insert a duplicate.
      await prisma.fleetDriver.upsert({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        create: { fleetId: fleet.id, driverAddress, status: 'PENDING', invitedAt },
        update: { status: 'PENDING', invitedAt, acceptedAt: null, removedAt: null },
      });
    },

    async acceptInvite(chainFleetId, driverAddress, acceptedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) return;

      await prisma.fleetDriver.update({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        data: { status: 'ACTIVE', acceptedAt },
      });
    },

    async removeDriver(chainFleetId, driverAddress, removedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) return;

      await prisma.fleetDriver.update({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        data: { removedAt },
      });
    },
  };
}
