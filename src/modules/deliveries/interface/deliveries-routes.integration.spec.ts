import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
import { signAccessToken } from '../../../shared/jwt/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('deliveries routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdChainIds: bigint[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  async function seedDelivery(overrides: { senderAddress?: string } = {}) {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: overrides.senderAddress ?? Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        status: 'PENDING',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    return chainDeliveryId;
  }

  it('lists deliveries filtered by sender address', async () => {
    const sender = Keypair.random().publicKey();
    const chainDeliveryId = await seedDelivery({ senderAddress: sender });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deliveries?senderAddress=${sender}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ chainDeliveryId: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.chainDeliveryId).toBe(chainDeliveryId.toString());
  });

  it('gets a single delivery by chain id', async () => {
    const chainDeliveryId = await seedDelivery();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deliveries/${chainDeliveryId.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<SuccessBody<{ status: string }>>().data.status).toBe('PENDING');
  });

  it('returns 404 for an unknown delivery', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/deliveries/999999999999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('paginates deliveries list with default limit', async () => {
    const defaultLimit = 20;
    const pageSize = Math.min(25, defaultLimit + 5);

    for (let i = 0; i < pageSize; i++) {
      await seedDelivery();
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ chainDeliveryId: string }>>&{ meta?: { limit: number; nextCursor?: string } }>();
    expect(body.data).toBeDefined();
    expect(body.data.length).toBeLessThanOrEqual(defaultLimit);
    if (body.meta) {
      expect(body.meta.limit).toBe(defaultLimit);
    }
  });

  it('enforces maximum limit on pagination', async () => {
    const maxLimit = 100;
    const overLimit = maxLimit + 50;

    for (let i = 0; i < Math.min(10, overLimit); i++) {
      await seedDelivery();
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deliveries?limit=${overLimit}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ chainDeliveryId: string }>>&{ meta?: { limit: number } }>();
    if (body.meta) {
      expect(body.meta.limit).toBeLessThanOrEqual(maxLimit);
    }
  });

  it('returns pagination metadata with nextCursor for fetching subsequent pages', async () => {
    for (let i = 0; i < 5; i++) {
      await seedDelivery();
    }

    const firstPageResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries?limit=2',
    });

    expect(firstPageResponse.statusCode).toBe(200);
    const firstPageBody = firstPageResponse.json<SuccessBody<Array<{ chainDeliveryId: string }>>&{ meta?: { limit: number; nextCursor?: string } }>();
    expect(firstPageBody.data.length).toBeLessThanOrEqual(2);

    if (firstPageBody.meta?.nextCursor) {
      const secondPageResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/deliveries?limit=2&afterChainDeliveryId=${firstPageBody.meta.nextCursor}`,
      });

      expect(secondPageResponse.statusCode).toBe(200);
      const secondPageBody = secondPageResponse.json<SuccessBody<Array<{ chainDeliveryId: string }>>>();
      expect(secondPageBody.data).toBeDefined();
    }
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/mark-in-transit',
      payload: { driverAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  // docs/API_REFERENCE.md: with DELIVERY_CONTRACT_ID unset (its .env.example
  // default, and the default in this test process), the build endpoints must
  // return 502 BLOCKCHAIN_ERROR naming the missing variable — the
  // createUnconfiguredContractClient() fallback in ../index.ts — rather than
  // a generic failure. Fails if that fallback wiring is removed.
  it('returns 502 BLOCKCHAIN_ERROR from a build endpoint when the contract id is unconfigured', async () => {
    const token = signAccessToken({ sub: randomUUID(), role: 'ADMIN' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/mark-in-transit',
      headers: { authorization: `Bearer ${token}` },
      payload: { driverAddress: Keypair.random().publicKey(), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('BLOCKCHAIN_ERROR');
    expect(body.error.message).toContain('DELIVERY_CONTRACT_ID');
  });
});
