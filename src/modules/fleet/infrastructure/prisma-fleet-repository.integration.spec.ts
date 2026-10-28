import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaFleetRepository } from './prisma-fleet-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma fleet repository (integration)', () => {
  const prisma = new PrismaClient();
  const fleetRepository = createPrismaFleetRepository(prisma);
  const createdChainIds: bigint[] = [];

  afterAll(async () => {
    if (createdChainIds.length > 0) {
      await prisma.fleet.deleteMany({ where: { chainFleetId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
  });

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  it('creates a fleet and finds it by chain fleet id with an empty driver list', async () => {
    const chainFleetId = nextChainId();

    await fleetRepository.create({
      chainFleetId,
      ownerAddress: 'GOWNER',
      treasuryAddress: 'GTREASURY',
    });

    const found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found).toMatchObject({
      chainFleetId,
      ownerAddress: 'GOWNER',
      treasuryAddress: 'GTREASURY',
      totalActiveDrivers: 0,
    });
    expect(found?.drivers).toEqual([]);
  });

  it('returns null for an unknown chain fleet id', async () => {
    const found = await fleetRepository.findByChainFleetId(999_999_999_999n);
    expect(found).toBeNull();
  });

  it('updates the treasury address', async () => {
    const chainFleetId = nextChainId();
    await fleetRepository.create({ chainFleetId, ownerAddress: 'GOWNER', treasuryAddress: 'GOLD' });

    await fleetRepository.updateTreasury(chainFleetId, 'GNEW');

    const found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.treasuryAddress).toBe('GNEW');
  });

  it('invites, accepts, and soft-removes a driver, tracking totalActiveDrivers', async () => {
    const chainFleetId = nextChainId();
    await fleetRepository.create({
      chainFleetId,
      ownerAddress: 'GOWNER',
      treasuryAddress: 'GTREASURY',
    });
    const invitedAt = new Date('2026-01-01T00:00:00Z');

    await fleetRepository.inviteDriver(chainFleetId, 'GDRIVER', invitedAt);
    let found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.drivers).toHaveLength(1);
    expect(found?.drivers[0]).toMatchObject({ driverAddress: 'GDRIVER', status: 'PENDING' });
    expect(found?.totalActiveDrivers).toBe(0);

    const acceptedAt = new Date('2026-01-02T00:00:00Z');
    await fleetRepository.acceptInvite(chainFleetId, 'GDRIVER', acceptedAt);
    found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.drivers[0]).toMatchObject({ status: 'ACTIVE', acceptedAt });
    expect(found?.totalActiveDrivers).toBe(1);

    const removedAt = new Date('2026-01-03T00:00:00Z');
    await fleetRepository.removeDriver(chainFleetId, 'GDRIVER', removedAt);
    found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.drivers).toHaveLength(1);
    expect(found?.drivers[0]?.removedAt).toEqual(removedAt);
    expect(found?.totalActiveDrivers).toBe(0);
  });

  it('re-inviting a previously removed driver resets the row instead of duplicating it', async () => {
    const chainFleetId = nextChainId();
    await fleetRepository.create({
      chainFleetId,
      ownerAddress: 'GOWNER',
      treasuryAddress: 'GTREASURY',
    });
    await fleetRepository.inviteDriver(chainFleetId, 'GDRIVER', new Date('2026-01-01T00:00:00Z'));
    await fleetRepository.acceptInvite(chainFleetId, 'GDRIVER', new Date('2026-01-02T00:00:00Z'));
    await fleetRepository.removeDriver(chainFleetId, 'GDRIVER', new Date('2026-01-03T00:00:00Z'));

    const reinvitedAt = new Date('2026-02-01T00:00:00Z');
    await fleetRepository.inviteDriver(chainFleetId, 'GDRIVER', reinvitedAt);

    const found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.drivers).toHaveLength(1);
    expect(found?.drivers[0]).toMatchObject({
      status: 'PENDING',
      invitedAt: reinvitedAt,
      acceptedAt: null,
      removedAt: null,
    });
  });

  it('re-accepting a previously removed driver clears removedAt and reactivates it', async () => {
    const chainFleetId = nextChainId();
    await fleetRepository.create({
      chainFleetId,
      ownerAddress: 'GOWNER',
      treasuryAddress: 'GTREASURY',
    });
    await fleetRepository.inviteDriver(chainFleetId, 'GDRIVER', new Date('2026-01-01T00:00:00Z'));
    await fleetRepository.acceptInvite(chainFleetId, 'GDRIVER', new Date('2026-01-02T00:00:00Z'));

    const removedAt = new Date('2026-01-03T00:00:00Z');
    await fleetRepository.removeDriver(chainFleetId, 'GDRIVER', removedAt);
    let found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.drivers[0]?.removedAt).toEqual(removedAt);

    const reacceptedAt = new Date('2026-02-01T00:00:00Z');
    await fleetRepository.acceptInvite(chainFleetId, 'GDRIVER', reacceptedAt);

    found = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(found?.drivers).toHaveLength(1);
    expect(found?.drivers[0]).toMatchObject({
      status: 'ACTIVE',
      acceptedAt: reacceptedAt,
      removedAt: null,
    });
    expect(found?.totalActiveDrivers).toBe(1);

    const activeOnly = await fleetRepository.findByChainFleetId(chainFleetId, {
      includeRemoved: false,
    });
    expect(activeOnly?.drivers).toHaveLength(1);
    expect(activeOnly?.drivers[0]).toMatchObject({ driverAddress: 'GDRIVER', status: 'ACTIVE' });
  });

  it('ignores removal when the fleet has not been indexed', async () => {
    const chainFleetId = nextChainId();
    await fleetRepository.removeDriver(chainFleetId, 'GMISSING_FLEET_DRIVER', new Date());
    expect(await fleetRepository.findByChainFleetId(chainFleetId)).toBeNull();
    expect(
      await prisma.fleetDriver.count({ where: { driverAddress: 'GMISSING_FLEET_DRIVER' } }),
    ).toBe(0);
  });

  it('records an out-of-order removal once and hides it from the default listing', async () => {
    const chainFleetId = nextChainId();
    await fleetRepository.create({
      chainFleetId,
      ownerAddress: 'GOWNER',
      treasuryAddress: 'GTREASURY',
    });
    const removedAt = new Date('2026-01-03T00:00:00Z');
    await fleetRepository.removeDriver(chainFleetId, 'GOUTOFORDER', removedAt);
    const first = await fleetRepository.findByChainFleetId(chainFleetId, { includeRemoved: true });
    await fleetRepository.removeDriver(chainFleetId, 'GOUTOFORDER', removedAt);
    const replayed = await fleetRepository.findByChainFleetId(chainFleetId, {
      includeRemoved: true,
    });
    expect(replayed?.drivers).toHaveLength(1);
    expect(replayed?.drivers[0]).toMatchObject({
      id: first?.drivers[0]?.id,
      driverAddress: 'GOUTOFORDER',
      status: 'PENDING',
      removedAt,
    });
    const visible = await fleetRepository.findByChainFleetId(chainFleetId);
    expect(visible?.drivers).toEqual([]);
    expect(visible?.totalActiveDrivers).toBe(0);
    expect(visible?.treasuryAddress).toBe('GTREASURY');
  });

  it('soft-removes only the selected fleet membership and preserves acceptance history', async () => {
    const chainFleetId = nextChainId();
    const otherChainFleetId = nextChainId();
    const invitedAt = new Date('2026-01-01T00:00:00Z');
    const acceptedAt = new Date('2026-01-02T00:00:00Z');
    const removedAt = new Date('2026-01-03T00:00:00Z');
    for (const id of [chainFleetId, otherChainFleetId]) {
      await fleetRepository.create({
        chainFleetId: id,
        ownerAddress: 'GOWNER',
        treasuryAddress: 'GTREASURY',
      });
      await fleetRepository.inviteDriver(id, 'GSHARED_DRIVER', invitedAt);
      await fleetRepository.acceptInvite(id, 'GSHARED_DRIVER', acceptedAt);
    }
    await fleetRepository.removeDriver(chainFleetId, 'GSHARED_DRIVER', removedAt);
    await fleetRepository.removeDriver(chainFleetId, 'GSHARED_DRIVER', removedAt);
    const removed = await fleetRepository.findByChainFleetId(chainFleetId, {
      includeRemoved: true,
    });
    expect(removed?.drivers).toHaveLength(1);
    expect(removed?.drivers[0]).toMatchObject({
      status: 'ACTIVE',
      invitedAt,
      acceptedAt,
      removedAt,
    });
    expect(removed?.totalActiveDrivers).toBe(0);
    expect((await fleetRepository.findByChainFleetId(chainFleetId))?.drivers).toEqual([]);
    const other = await fleetRepository.findByChainFleetId(otherChainFleetId);
    expect(other?.drivers).toHaveLength(1);
    expect(other?.drivers[0]).toMatchObject({ status: 'ACTIVE', acceptedAt, removedAt: null });
    expect(other?.totalActiveDrivers).toBe(1);
  });
});
