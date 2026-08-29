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
 *
 * The indexer starts at the chain tip with no backfill, so a fleet's
 * *subsequent* events arriving for an already-indexed (or, on replay,
 * already-processed) row is the common case, not the edge case. Every write
 * path here therefore follows one strategy for "the parent row may not
 * exist yet / may already exist": an idempotent upsert wherever the event
 * carries the full data needed to construct a correct row on its own
 * (`create`, `inviteDriver`, `acceptInvite`, `removeDriver` — the latter two
 * keyed on `(fleetId, driverAddress)`, the complete `FleetDriver` unique
 * key, so they no longer require a prior `driver_invited` to have been
 * observed first), or an explicit skip-with-log where it doesn't
 * (`updateTreasury`, and the fleet-not-found guards below) — never a bare
 * `create`/`update` that throws `P2002`/`P2025` on the out-of-order case.
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
      // `upsert`, not `create`: a replayed/redelivered `fleet_registered`
      // for a fleet this repository already indexed must not throw P2002 —
      // it settles the row to the (idempotent) values the event carries.
      const upserted = await prisma.fleet.upsert({
        where: { chainFleetId: record.chainFleetId },
        create: {
          chainFleetId: record.chainFleetId,
          ownerAddress: record.ownerAddress,
          treasuryAddress: record.treasuryAddress,
        },
        update: {
          ownerAddress: record.ownerAddress,
          treasuryAddress: record.treasuryAddress,
        },
      });
      return toFleet(upserted);
    },

    async updateTreasury(chainFleetId, treasuryAddress) {
      // `updateMany`, not `update`: a `fleet_treasury_updated` for a fleet
      // this repository hasn't indexed yet (the common case — the indexer
      // starts at the chain tip with no backfill) must not throw P2025.
      const result = await prisma.fleet.updateMany({
        where: { chainFleetId },
        data: { treasuryAddress },
      });
      if (result.count === 0) {
        console.debug(
          `[fleet] fleet_treasury_updated skipped — no indexed fleet for chainFleetId=${chainFleetId}.`,
        );
      }
    },

    async inviteDriver(chainFleetId, driverAddress, invitedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) {
        console.debug(
          `[fleet] driver_invited skipped — no indexed fleet for chainFleetId=${chainFleetId}.`,
        );
        return;
      }

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
      if (!fleet) {
        console.debug(
          `[fleet] invite_accepted skipped — no indexed fleet for chainFleetId=${chainFleetId}.`,
        );
        return;
      }

      // `upsert`, not `update`: `invite_accepted` can be observed without
      // its preceding `driver_invited` ever having been indexed (this
      // repository's own header comment) — the event carries
      // `(fleetId, driverAddress)`, the complete `FleetDriver` unique key,
      // which is enough to construct a correct ACTIVE row on its own rather
      // than requiring a prior invite row to exist and throwing P2025 when
      // it doesn't. `invitedAt` is left to its schema default (`now()`) in
      // that out-of-order case — the true invite time was never observed.
      await prisma.fleetDriver.upsert({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        create: { fleetId: fleet.id, driverAddress, status: 'ACTIVE', acceptedAt },
        update: { status: 'ACTIVE', acceptedAt },
      });
    },

    async removeDriver(chainFleetId, driverAddress, removedAt) {
      const fleet = await prisma.fleet.findUnique({ where: { chainFleetId } });
      if (!fleet) {
        console.debug(
          `[fleet] driver_removed skipped — no indexed fleet for chainFleetId=${chainFleetId}.`,
        );
        return;
      }

      // `upsert`, not `update` — same out-of-order rationale as
      // `acceptInvite` above: `driver_removed` carries the full
      // `(fleetId, driverAddress)` unique key, so a driver row that was
      // never observed being invited/accepted can still be recorded as
      // removed rather than throwing P2025.
      await prisma.fleetDriver.upsert({
        where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress } },
        create: { fleetId: fleet.id, driverAddress, removedAt },
        update: { removedAt },
      });
    },
  };
}
