import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFleetModule } from '../src/modules/fleet/index.js';
import { createPrismaFleetRepository } from '../src/modules/fleet/infrastructure/prisma-fleet-repository.js';
import {
  buildFleetWithDrivers,
  createInMemoryFleetRepository,
} from '../src/modules/fleet/application/__fixtures__/fakes.js';
import { ValidationError, handleError } from '../src/shared/errors/index.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

const prisma = new PrismaClient();
const repository = createPrismaFleetRepository(prisma);
const fake = createInMemoryFleetRepository();
const app = Fastify();
const owner = testAddress('fleet-list-owner');
const other = testAddress('fleet-list-other');
const ids: string[] = [];
const chainBase = 9007199254700000n;
let userId: string;
let token: string;

beforeAll(async () => {
  for (let i = 1; i <= 25; i++) {
    const id = randomUUID();
    ids.push(id);
    const record = {
      id,
      chainFleetId: chainBase + BigInt(i),
      ownerAddress: i <= 22 ? owner : other,
      treasuryAddress: owner,
      createdAt: new Date(i <= 2 ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    };
    await prisma.fleet.create({ data: record });
    fake.seed(buildFleetWithDrivers({ ...record, drivers: [] }));
  }
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@fleet-list.invalid`, passwordHash: 'fixture-only' },
  });
  userId = user.id;
  token = signAccessToken({ sub: userId, role: 'CUSTOMER', tokenVersion: 0 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(createFleetModule(prisma));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.fleet.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await disconnectPrisma();
});

describe.each([
  ['Prisma', repository],
  ['in-memory', fake],
] as const)('%s owner-list contract', (_name, repo) => {
  it('returns the default first20 for exactly one wallet, newest first with deterministic ties', async () => {
    const result = await repo.listFleetsByOwner(owner);
    expect(result).toHaveLength(20);
    expect(result.every((fleet) => fleet.ownerAddress === owner)).toBe(true);
    const expected = ids.slice(2, 22).sort().reverse();
    expect(result.map((fleet) => fleet.id)).toEqual(expected);
    expect((await repo.listFleetsByOwner(owner)).map((fleet) => fleet.id)).toEqual(expected);
  });

  it('paginates without overlaps, preserves page size at the last page and returns empty beyond it', async () => {
    const first = await repo.listFleetsByOwner(owner, { page: 1, limit: 20 });
    const second = await repo.listFleetsByOwner(owner, { page: 2, limit: 20 });
    expect(second.map((fleet) => fleet.id)).toEqual(ids.slice(0, 2).sort().reverse());
    expect(new Set([...first, ...second].map((fleet) => fleet.id)).size).toBe(22);
    expect(await repo.listFleetsByOwner(owner, { page: 3, limit: 20 })).toEqual([]);
    expect(await repo.listFleetsByOwner(owner, { page: 23, limit: 1 })).toEqual([]);
    expect(await repo.listFleetsByOwner(owner, { page: 22, limit: 1 })).toHaveLength(1);
  });

  it('does not treat a user ID, another wallet, or empty owner as an ownership wildcard', async () => {
    expect(await repo.listFleetsByOwner(userId)).toEqual([]);
    expect(await repo.listFleetsByOwner('')).toEqual([]);
    const theirs = await repo.listFleetsByOwner(other);
    expect(theirs).toHaveLength(3);
    expect(theirs.every((fleet) => fleet.ownerAddress === other)).toBe(true);
  });

  it.each([
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { limit: 0 },
    { limit: -1 },
    { limit: Infinity },
    { page: Number.MAX_SAFE_INTEGER, limit: 2 },
  ])('rejects invalid pagination %j', async (options) => {
    await expect(repo.listFleetsByOwner(owner, options)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('existing fleet HTTP visibility and boundaries', () => {
  const url = `/fleets/${chainBase + 1n}`;
  const headers = () => ({ authorization: `Bearer ${token}` });
  it('preserves authentication and the absence of an owner-list HTTP endpoint', async () => {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url: '/fleets', headers: headers() })).statusCode).toBe(404);
  });

  it('bounds current/historical members without changing active counts or persisted removal', async () => {
    const fleetId = chainBase + 1n;
    const drivers = [
      testAddress('list-active-a'),
      testAddress('list-active-b'),
      testAddress('list-removed'),
    ];
    for (const [index, driver] of drivers.entries()) {
      await repository.inviteDriver(fleetId, driver, new Date(Date.UTC(2026, 0, index + 1)));
      await repository.acceptInvite(fleetId, driver, new Date('2026-01-04T00:00:00Z'));
    }
    await repository.removeDriver(fleetId, drivers[2]!, new Date('2026-01-05T00:00:00Z'));
    const current = await app.inject({
      url: url + '?includeRemoved=false&driverLimit=1',
      headers: headers(),
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().data.drivers).toHaveLength(1);
    expect(current.json().data.drivers[0].removedAt).toBeNull();
    expect(current.json().data.totalActiveDrivers).toBe(2);
    const defaults = await app.inject({ url, headers: headers() });
    expect(defaults.json().data.drivers).toHaveLength(2);
    const history = await app.inject({
      url: url + '?includeRemoved=true&driverLimit=1',
      headers: headers(),
    });
    expect(history.json().data.drivers).toHaveLength(1);
    expect(history.json().data.drivers[0].driverAddress).toBe(drivers[2]);
    expect(history.json().data.drivers[0].removedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(history.json().data.totalActiveDrivers).toBe(2);
    expect(
      (await repository.findByChainFleetId(fleetId, { includeRemoved: true }))?.drivers,
    ).toHaveLength(3);
  });

  it.each(['driverLimit=0', 'driverLimit=501', 'driverLimit=1.5', 'includeRemoved=maybe'])(
    'rejects invalid HTTP boundaries %s',
    async (query) => {
      const response = await app.inject({ url: url + '?' + query, headers: headers() });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    },
  );
});
