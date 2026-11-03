import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrismaEscrowRepository } from '../src/modules/escrow/infrastructure/prisma-escrow-repository.js';
import { createPrismaAnalyticsReader } from '../src/modules/analytics/infrastructure/prisma-analytics-reader.js';
import { createSyncEscrowFromEventUseCase } from '../src/modules/escrow/application/sync-escrow-from-event.js';
import { createGetEscrowUseCase } from '../src/modules/escrow/application/get-escrow.js';
import { createBuildEscrowTransactionsUseCases } from '../src/modules/escrow/application/build-escrow-transactions.js';
import {
  buildChainEscrowRecord,
  buildEscrowEvent,
  createFakeEscrowContractReader,
  createFakeEscrowTransactionBuilder,
} from '../src/modules/escrow/application/__fixtures__/fakes.js';
import { createEscrowRoutes } from '../src/modules/escrow/interface/routes.js';
import { createAnalyticsRoutes } from '../src/modules/analytics/interface/routes.js';
import {
  createGetGmvUseCase,
  createGetCompletionRateUseCase,
  createGetDisputeRateUseCase,
  createGetDriverTierDistributionUseCase,
} from '../src/modules/analytics/application/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { handleError } from '../src/shared/errors/index.js';

const prisma = new PrismaClient();
const repository = createPrismaEscrowRepository(prisma);
const analytics = createPrismaAnalyticsReader(prisma);
const app = Fastify();
const ids: bigint[] = [];
const allowed = `allowed-${randomUUID()}`;
const rogue = `rogue-${randomUUID()}`;

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(
    createEscrowRoutes({
      getEscrow: createGetEscrowUseCase({ escrowRepository: repository }),
      buildTransactions: createBuildEscrowTransactionsUseCases({
        transactionBuilder: createFakeEscrowTransactionBuilder(),
      }),
    }),
  );
  await app.register(
    createAnalyticsRoutes({
      getGmv: createGetGmvUseCase({ analyticsReader: analytics }),
      getCompletionRate: createGetCompletionRateUseCase({ analyticsReader: analytics }),
      getDisputeRate: createGetDisputeRateUseCase({ analyticsReader: analytics }),
      getDriverTierDistribution: createGetDriverTierDistributionUseCase({
        analyticsReader: analytics,
      }),
    }),
  );
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.escrow.deleteMany({ where: { chainDeliveryId: { in: ids } } });
  await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: ids } } });
  await prisma.$disconnect();
  await disconnectPrisma();
});

it.each([true, false])(
  'persists funded token decision %s across release and the API without changing authorization',
  async (verified) => {
    const id = BigInt(Date.now()) * 1000000n + BigInt(ids.length);
    ids.push(id);
    await prisma.delivery.create({
      data: {
        chainDeliveryId: id,
        senderAddress: 'sender',
        recipientAddress: 'recipient',
        origin: 'A',
        destination: 'B',
        cargoCategory: 'GENERAL',
        weightGrams: 1,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    const token = verified ? allowed : rogue;
    const reader = createFakeEscrowContractReader();
    // A supplied chain-side flag must never override the local allowlist decision.
    reader.seed(
      id,
      buildChainEscrowRecord({ chainDeliveryId: id, token, amount: 123n, isVerified: !verified }),
    );
    const sync = createSyncEscrowFromEventUseCase({
      escrowRepository: repository,
      contractReader: reader,
      allowedTokens: [allowed],
    });
    await sync(buildEscrowEvent({ topic: ['escrow_funded', id.toString()] }));
    expect((await repository.findByChainDeliveryId(id))?.isVerified).toBe(verified);
    await sync(
      buildEscrowEvent({
        topic: ['escrow_released', id.toString()],
        payload: ['sender', 'recipient', '1'],
      }),
    );
    expect((await repository.findByChainDeliveryId(id))?.isVerified).toBe(verified);
    const row = (await analytics.getGmvByToken()).find((entry) => entry.token === token);
    expect(row).toEqual(verified ? { token, releasedAmount: 123n, releasedCount: 1 } : undefined);
    const response = await app.inject({ method: 'GET', url: `/escrow/${id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      chainDeliveryId: id.toString(),
      token,
      amount: '123',
      status: 'RELEASED',
    });
    // Existing public DTO omits this internal analytics flag for either state.
    expect(response.json().data).not.toHaveProperty('isVerified');
    expect(
      (await app.inject({ method: 'POST', url: '/transactions/build/release-escrow', payload: {} }))
        .statusCode,
    ).toBe(401);
  },
);

it('keeps GMV restricted to authoritative administrator roles for either email state', async () => {
  expect((await app.inject({ method: 'GET', url: '/analytics/gmv' })).statusCode).toBe(401);
  for (const emailVerifiedAt of [null, new Date('2026-01-01T00:00:00Z')]) {
    for (const role of ['CUSTOMER', 'ADMIN'] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@verification.invalid`,
          passwordHash: 'synthetic',
          role,
          emailVerifiedAt,
        },
      });
      try {
        // A forged role claim must not elevate a customer in the primary database.
        const accessToken = signAccessToken({ sub: user.id, role: 'ADMIN', tokenVersion: 0 });
        const response = await app.inject({
          method: 'GET',
          url: '/analytics/gmv',
          headers: { authorization: `Bearer ${accessToken}` },
        });
        expect(response.statusCode).toBe(role === 'ADMIN' ? 200 : 403);
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
        ).toEqual(emailVerifiedAt);
      } finally {
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
  }
});
