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
});
