import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDeliveriesModule } from '../src/modules/deliveries/index.js';
import { createDeliveriesRoutes } from '../src/modules/deliveries/interface/routes.js';
import { createPrismaDeliveryRepository } from '../src/modules/deliveries/infrastructure/prisma-delivery-repository.js';
import { createPrismaWalletAddressRepository } from '../src/modules/users/infrastructure/prisma-wallet-address-repository.js';
import {
  createGetDeliveryUseCase,
  createListDeliveriesUseCase,
  createBuildDeliveryTransactionsUseCases,
} from '../src/modules/deliveries/application/index.js';
import { createFakeDeliveryTransactionBuilder } from '../src/modules/deliveries/application/__fixtures__/fakes.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { handleError } from '../src/shared/errors/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

const prisma = new PrismaClient();
const walletRepository = createPrismaWalletAddressRepository(prisma);
const deliveryRepository = createPrismaDeliveryRepository(prisma);
const app = Fastify();
const ids: string[] = [];
const ownerAddress = testAddress('delivery-wiring-owner');
const foreignAddress = testAddress('delivery-wiring-foreign');
const unlinkedAddress = testAddress('delivery-wiring-unlinked');
const driverAddress = testAddress('delivery-wiring-driver');
const chainId = 9007199254700100n;
let ownerId: string;
let ownerToken: string;
let adminToken: string;
let revokedToken: string;
const transactionBuilder = createFakeDeliveryTransactionBuilder();
const assign = vi.spyOn(transactionBuilder, 'buildAssignDriver');
const dispute = vi.spyOn(transactionBuilder, 'buildRaiseDispute');
const lookup = vi.spyOn(walletRepository, 'findByAddress');

beforeAll(async () => {
  for (const role of ['CUSTOMER', 'ADMIN'] as const) {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@delivery-wiring.invalid`,
        passwordHash: 'fixture-only',
        role,
      },
    });
    ids.push(user.id);
    const token = signAccessToken({ sub: user.id, role, tokenVersion: 0 });
    await walletRepository.create({
      userId: user.id,
      address: role === 'CUSTOMER' ? ownerAddress : foreignAddress,
      isPrimary: true,
      verifiedAt: new Date(),
    });
    if (role === 'CUSTOMER') {
      ownerId = user.id;
      ownerToken = token;
      revokedToken = signAccessToken({ sub: user.id, role, tokenVersion: -1 });
    } else adminToken = token;
  }
  await prisma.delivery.create({
    data: {
      chainDeliveryId: chainId,
      senderAddress: ownerAddress,
      recipientAddress: foreignAddress,
      status: 'PENDING',
      origin: 'A',
      destination: 'B',
      cargoCategory: 'GENERAL',
      weightGrams: 500,
      fragile: false,
      createdAtChain: new Date('2026-01-01T00:00:00Z'),
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(createDeliveriesModule(prisma));
  await app.register(
    createDeliveriesRoutes(
      {
        getDelivery: createGetDeliveryUseCase({ deliveryRepository }),
        listDeliveries: createListDeliveriesUseCase({ deliveryRepository }),
        buildTransactions: createBuildDeliveryTransactionsUseCases({ transactionBuilder }),
      },
      { walletAddressRepository: walletRepository },
    ),
    { prefix: '/injected' },
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.delivery.deleteMany({ where: { chainDeliveryId: chainId } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await disconnectPrisma();
});

describe.each(['assign-driver', 'raise-delivery-dispute'] as const)(
  '%s ownership dependency',
  (path) => {
    const payload = (callerAddress: string) => ({
      callerAddress,
      chainDeliveryId: chainId.toString(),
      ...(path === 'assign-driver' ? { driverAddress } : {}),
    });
    const request = (address: string, token = ownerToken, prefix = '/injected') =>
      app.inject({
        method: 'POST',
        url: `${prefix}/transactions/build/${path}`,
        headers: { authorization: `Bearer ${token}` },
        payload: payload(address),
      });
    const builder = () => (path === 'assign-driver' ? assign : dispute);

    it('rejects anonymous and revoked credentials before wallet lookup or builder', async () => {
      lookup.mockClear();
      builder().mockClear();
      const response = await app.inject({
        method: 'POST',
        url: `/injected/transactions/build/${path}`,
        payload: payload(ownerAddress),
      });
      expect(response.statusCode).toBe(401);
      expect((await request(ownerAddress, revokedToken)).statusCode).toBe(401);
      expect(lookup).not.toHaveBeenCalled();
      expect(builder()).not.toHaveBeenCalled();
    });

    it.each([foreignAddress, unlinkedAddress])(
      'rejects foreign/unlinked wallet %s with the historical403',
      async (address) => {
        builder().mockClear();
        const response = await request(address);
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toEqual({
          code: 'FORBIDDEN',
          message: 'Caller address is not linked to your account',
        });
        expect(builder()).not.toHaveBeenCalled();
        expect((await request(address, ownerToken, '')).statusCode).toBe(403);
      },
    );

    it('does not grant an administrator ownership of another account wallet', async () => {
      expect((await request(ownerAddress, adminToken)).statusCode).toBe(403);
    });

    it('injects the actual wallet repository and delegates exact typed input only after ownership', async () => {
      builder().mockClear();
      lookup.mockClear();
      const before = await prisma.delivery.findUniqueOrThrow({
        where: { chainDeliveryId: chainId },
      });
      const response = await request(ownerAddress);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.xdr).toBe(
        path === 'assign-driver' ? 'unsigned-xdr:assign-driver' : 'unsigned-xdr:raise-dispute',
      );
      expect(lookup).toHaveBeenCalledWith(ownerAddress);
      expect(builder()).toHaveBeenCalledWith({
        callerAddress: ownerAddress,
        chainDeliveryId: chainId,
        ...(path === 'assign-driver' ? { driverAddress } : {}),
      });
      expect(
        await prisma.delivery.findUniqueOrThrow({ where: { chainDeliveryId: chainId } }),
      ).toEqual(before);
      const unconfigured = await request(ownerAddress, ownerToken, '');
      expect(unconfigured.statusCode).toBe(502);
      expect(unconfigured.json().error.code).toBe('BLOCKCHAIN_ERROR');
    });

    it('fails closed on lookup failure and preserves builder failures', async () => {
      builder().mockClear();
      lookup.mockRejectedValueOnce(new Error('isolated lookup failure'));
      expect((await request(ownerAddress)).statusCode).toBe(500);
      expect(builder()).not.toHaveBeenCalled();
      builder().mockRejectedValueOnce(new Error('isolated builder failure'));
      expect((await request(ownerAddress)).statusCode).toBe(500);
    });

    it('rejects malformed input before invoking the wallet repository', async () => {
      lookup.mockClear();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/injected/transactions/build/${path}`,
            headers: { authorization: `Bearer ${ownerToken}` },
            payload: { ...payload(ownerAddress), callerAddress: 'bad' },
          })
        ).statusCode,
      ).toBe(400);
      expect(lookup).not.toHaveBeenCalled();
    });
  },
);

describe('unchanged delivery reads and current ownership', () => {
  it('uses actual module reads, query filters, serialization and unknown-ID mapping', async () => {
    const headers = { authorization: `Bearer ${ownerToken}` };
    expect((await app.inject({ url: `/deliveries/${chainId}` })).statusCode).toBe(401);
    const detail = await app.inject({ url: `/deliveries/${chainId}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      chainDeliveryId: chainId.toString(),
      status: 'PENDING',
      senderAddress: ownerAddress,
      weightGrams: 500,
    });
    const list = await app.inject({
      url: `/deliveries?senderAddress=${ownerAddress}&status=PENDING`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect((await app.inject({ url: `/deliveries/${chainId + 1n}`, headers })).statusCode).toBe(
      404,
    );
  });

  it('rechecks live wallet links on each request', async () => {
    const wallet = await prisma.walletAddress.findUniqueOrThrow({
      where: { address: ownerAddress },
    });
    await walletRepository.remove(wallet.id);
    const response = await app.inject({
      method: 'POST',
      url: '/transactions/build/assign-driver',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { callerAddress: ownerAddress, chainDeliveryId: chainId.toString(), driverAddress },
    });
    expect(response.statusCode).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).tokenVersion).toBe(0);
  });
});
