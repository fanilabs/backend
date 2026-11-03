import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
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
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    if (createdEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  /** A real registered + logged-in account, not a hand-signed JWT for a
   * nonexistent user id — `authenticate` now looks the subject up in the
   * database (security issue #12's `tokenVersion` check), so a token for a
   * user that was never actually created is correctly rejected as
   * unauthorized before ever reaching a route handler. */
  async function registerUser(): Promise<{ accessToken: string; userId: string }> {
    const email = `delivery-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return {
      accessToken: login.json<SuccessBody<{ accessToken: string }>>().data.accessToken,
      userId: user.id,
    };
  }

  /** Registers a real account and links a fresh Stellar wallet to it directly
   * via Prisma (wallet linking itself is covered by `users`' own tests). */
  async function registerWithWallet(): Promise<{ accessToken: string; address: string }> {
    const { accessToken, userId } = await registerUser();
    const address = Keypair.random().publicKey();
    await prisma.walletAddress.create({
      data: { userId, address, isPrimary: true, verifiedAt: new Date() },
    });
    return { accessToken, address };
  }

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
        senderAddress: overrides.senderAddress ?? `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
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
    const { accessToken } = await registerUser();
    const sender = Keypair.random().publicKey();
    const chainDeliveryId = await seedDelivery({ senderAddress: sender });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deliveries?senderAddress=${sender}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ chainDeliveryId: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(typeof body.data[0]?.chainDeliveryId).toBe('string');
    expect(body.data[0]?.chainDeliveryId).toBe(chainDeliveryId.toString());
  });

  it('gets a single delivery by chain id and serializes chainDeliveryId as string', async () => {
    const { accessToken } = await registerUser();
    const chainDeliveryId = await seedDelivery();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/deliveries/${chainDeliveryId.toString()}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ chainDeliveryId: string; status: string }>>();
    expect(body.data.status).toBe('PENDING');
    expect(typeof body.data.chainDeliveryId).toBe('string');
    expect(body.data.chainDeliveryId).toBe(chainDeliveryId.toString());
  });

  it('rejects an unauthenticated single-delivery request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries/1',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown delivery', async () => {
    const { accessToken } = await registerUser();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries/999999999999999',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/mark-in-transit',
      payload: { driverAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated confirm-delivery request before body validation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/confirm-delivery',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated cancel-delivery request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/cancel-delivery',
      payload: { senderAddress: Keypair.random().publicKey(), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated create-delivery request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/create-delivery',
      payload: {
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        estimatedDelivery: new Date().toISOString(),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects assign-driver with a caller address not linked to the caller', async () => {
    const { accessToken } = await registerUser();
    const unlinkedAddress = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/assign-driver',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        callerAddress: unlinkedAddress,
        chainDeliveryId: '1',
        driverAddress: Keypair.random().publicKey(),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('rejects raise-delivery-dispute with a caller address not linked to the caller', async () => {
    const { accessToken } = await registerUser();
    const unlinkedAddress = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/raise-delivery-dispute',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { callerAddress: unlinkedAddress, chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('does not reject assign-driver when the caller address is linked to the caller', async () => {
    const { accessToken, address } = await registerWithWallet();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/assign-driver',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        callerAddress: address,
        chainDeliveryId: '1',
        driverAddress: Keypair.random().publicKey(),
      },
    });

    // Ownership passed (not 403); with DELIVERY_CONTRACT_ID unconfigured the
    // builder returns 502 BLOCKCHAIN_ERROR, or 200 with XDR when configured.
    expect([200, 502]).toContain(response.statusCode);
    if (response.statusCode === 502) {
      const body = response.json<ErrorBody>();
      expect(body.error.code).toBe('BLOCKCHAIN_ERROR');
      expect(body.error.message).toContain('DELIVERY_CONTRACT_ID');
    }
  });

  // Regression coverage for the raise-dispute/raise-delivery-dispute route
  // collision (this endpoint previously had no HTTP-level coverage at all —
  // only a unit-level use-case-delegation test) — see
  // src/modules/deliveries/interface/routes.ts's doc comment on this route
  // for why it was renamed away from `raise-dispute`, which `disputes`
  // module now owns exclusively.
  it('rejects an unauthenticated raise-delivery-dispute request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/raise-delivery-dispute',
      payload: { callerAddress: Keypair.random().publicKey(), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  // Same fallback pattern as disputes-routes.integration.spec.ts's
  // equivalent test: DELIVERY_CONTRACT_ID is unset (its .env.example
  // default, and this test process's default), so an authenticated request
  // must still reach the handler and fail with the unconfigured-contract
  // fallback, not a 404 (which would mean the route doesn't exist) or a
  // generic 500.
  it('reaches the raise-delivery-dispute handler and returns 502 BLOCKCHAIN_ERROR when DELIVERY_CONTRACT_ID is unconfigured', async () => {
    const { accessToken, address } = await registerWithWallet();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/raise-delivery-dispute',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { callerAddress: address, chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('BLOCKCHAIN_ERROR');
    expect(body.error.message).toContain('DELIVERY_CONTRACT_ID');
  });
});
