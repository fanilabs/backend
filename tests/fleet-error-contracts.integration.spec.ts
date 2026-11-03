import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DriverAlreadyInFleetError,
  DriverFleetRecordNotFoundError,
  DriverPayoutAddressNotFoundError,
  FleetNotFoundError,
} from '../src/modules/fleet/domain/index.js';
import { AppError } from '../src/shared/errors/app-error.js';
import { handleError } from '../src/shared/errors/index.js';
import { createFleetModule } from '../src/modules/fleet/index.js';
import { createPrismaFleetRepository } from '../src/modules/fleet/infrastructure/prisma-fleet-repository.js';
import { createBuildFleetTransactionsUseCases } from '../src/modules/fleet/application/build-fleet-transactions.js';
import { createFakeFleetTransactionBuilder } from '../src/modules/fleet/application/__fixtures__/fakes.js';
import { createGetFleetUseCase } from '../src/modules/fleet/application/get-fleet.js';
import { createGetPayoutAddressUseCase } from '../src/modules/fleet/application/get-payout-address.js';
import { createFleetRoutes } from '../src/modules/fleet/interface/routes.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

const prisma = new PrismaClient();
const repository = createPrismaFleetRepository(prisma);
const app = Fastify();
const chainFleetId = 9007199254740993n;
const driverAddress = testAddress('fleet-errors-driver');
const callerAddress = testAddress('fleet-errors-owner');
let userId: string;
let token: string;
const active = vi.fn<(id: bigint, driver: string) => Promise<boolean>>();
const transactionBuilder = createFakeFleetTransactionBuilder();
const build = vi.spyOn(transactionBuilder, 'buildAddDriverToFleet');
const buildTransactions = createBuildFleetTransactionsUseCases({
  transactionBuilder,
  fleetRepository: { isDriverActiveInFleet: active },
});

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@fleet-errors.invalid`, passwordHash: 'fixture-only' },
  });
  userId = user.id;
  token = signAccessToken({ sub: userId, role: 'CUSTOMER', tokenVersion: 0 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(createFleetModule(prisma));
  // Exercise the existing optional guard; production composition remains unchanged.
  await app.register(
    createFleetRoutes({
      getFleet: createGetFleetUseCase({ fleetRepository: repository }),
      getPayoutAddress: createGetPayoutAddressUseCase({
        contractReader: {
          async getPayoutAddress() {
            throw new DriverPayoutAddressNotFoundError();
          },
        },
      }),
      buildTransactions,
    }),
    { prefix: '/guarded' },
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.fleet.deleteMany({ where: { chainFleetId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await disconnectPrisma();
});

describe('canonical fleet errors', () => {
  it.each([
    [new FleetNotFoundError(), 404, 'NOT_FOUND', 'Fleet not found'],
    [
      new DriverFleetRecordNotFoundError(),
      404,
      'NOT_FOUND',
      'No fleet-membership record found for this driver',
    ],
    [
      new DriverPayoutAddressNotFoundError(),
      404,
      'DRIVER_NOT_FOUND',
      'Driver payout address not found',
    ],
    [
      new DriverAlreadyInFleetError(driverAddress, chainFleetId),
      409,
      'CONFLICT',
      `Driver ${driverAddress} is already active in fleet ${chainFleetId}`,
    ],
  ] as const)('satisfies the application error contract (%s)', (error, status, code, message) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.name).toBe(error.constructor.name);
    expect(error.details).toBeUndefined();
  });

  it('keeps constructor custom messages without misusing status as details', () => {
    expect(new FleetNotFoundError('custom')).toMatchObject({
      message: 'custom',
      statusCode: 404,
      code: 'NOT_FOUND',
      details: undefined,
    });
  });
});

describe('real fleet HTTP/repository contracts', () => {
  const headers = () => ({ authorization: `Bearer ${token}` });
  const payload = { callerAddress, driverAddress, chainFleetId: chainFleetId.toString() };
  const url = '/guarded/transactions/build/add-driver-to-fleet';

  it('authenticates fleet reads before returning the historical not-found mapping', async () => {
    expect((await app.inject({ url: `/fleets/${chainFleetId}` })).statusCode).toBe(401);
    const response = await app.inject({ url: `/fleets/${chainFleetId}`, headers: headers() });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({ code: 'NOT_FOUND', message: 'Fleet not found' });
  });

  it('rejects anonymous and revoked-token invitations before invoking the optional guard', async () => {
    active.mockClear();
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    const revoked = signAccessToken({ sub: userId, role: 'CUSTOMER', tokenVersion: -1 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload,
          headers: { authorization: `Bearer ${revoked}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(active).not.toHaveBeenCalled();
  });

  it('maps active-driver rejection to 409 and retains bigint identity without building', async () => {
    active.mockResolvedValue(true);
    build.mockClear();
    const response = await app.inject({ method: 'POST', url, payload, headers: headers() });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
    expect(response.json().error.message).toContain(chainFleetId.toString());
    expect(active).toHaveBeenCalledWith(chainFleetId, driverAddress);
    expect(build).not.toHaveBeenCalled();
  });

  it('preserves false, absent and failed optional-check paths', async () => {
    active.mockResolvedValue(false);
    const input = { callerAddress, driverAddress, chainFleetId };
    await expect(buildTransactions.buildAddDriverToFleetTransaction(input)).resolves.toBe(
      'unsigned-xdr:add-driver-to-fleet',
    );
    expect(build).toHaveBeenCalledWith(input);
    await expect(
      createBuildFleetTransactionsUseCases({ transactionBuilder }).buildAddDriverToFleetTransaction(
        input,
      ),
    ).resolves.toBe('unsigned-xdr:add-driver-to-fleet');
    const failure = new Error('fixture read failure');
    active.mockRejectedValue(failure);
    build.mockClear();
    await expect(buildTransactions.buildAddDriverToFleetTransaction(input)).rejects.toBe(failure);
    expect(build).not.toHaveBeenCalled();
  });

  it('preserves the existing payout error HTTP status and public read policy', async () => {
    const response = await app.inject({
      url: `/guarded/fleets/${chainFleetId}/payout-address/${driverAddress}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({
      code: 'DRIVER_NOT_FOUND',
      message: 'Driver payout address not found',
    });
  });

  it('retains invite, accept, remove, historical listing and re-invite persistence', async () => {
    await repository.create({
      chainFleetId,
      ownerAddress: callerAddress,
      treasuryAddress: callerAddress,
    });
    const invitedAt = new Date('2026-01-01T00:00:00.000Z');
    const acceptedAt = new Date('2026-01-02T00:00:00.000Z');
    const removedAt = new Date('2026-01-03T00:00:00.000Z');
    await repository.inviteDriver(chainFleetId, driverAddress, invitedAt);
    await repository.acceptInvite(chainFleetId, driverAddress, acceptedAt);
    const activeFleet = await repository.findByChainFleetId(chainFleetId);
    expect(activeFleet?.totalActiveDrivers).toBe(1);
    expect(activeFleet?.drivers[0]).toMatchObject({
      status: 'ACTIVE',
      invitedAt,
      acceptedAt,
      removedAt: null,
    });
    await repository.removeDriver(chainFleetId, driverAddress, removedAt);
    expect((await repository.findByChainFleetId(chainFleetId))?.drivers).toEqual([]);
    const historical = await repository.findByChainFleetId(chainFleetId, { includeRemoved: true });
    expect(historical?.totalActiveDrivers).toBe(0);
    expect(historical?.drivers[0]).toMatchObject({
      status: 'ACTIVE',
      invitedAt,
      acceptedAt,
      removedAt,
    });
    const response = await app.inject({
      url: `/fleets/${chainFleetId}?includeRemoved=true`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.drivers[0].removedAt).toBe(removedAt.toISOString());
    await repository.inviteDriver(chainFleetId, driverAddress, invitedAt);
    expect((await repository.findByChainFleetId(chainFleetId))?.drivers[0]).toMatchObject({
      id: historical?.drivers[0]?.id,
      status: 'PENDING',
      invitedAt,
      acceptedAt: null,
      removedAt: null,
    });
  });
});
