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

describe.skipIf(!dbAvailable)('reputation routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdAddresses: string[] = [];
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdAddresses.length > 0) {
      await prisma.driverProfile.deleteMany({ where: { address: { in: createdAddresses } } });
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

  async function registerAndLogin(role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER'): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const email = `reputation-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    }
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

  async function seedDriverProfile() {
    const address = Keypair.random().publicKey();
    createdAddresses.push(address);
    await prisma.driverProfile.create({
      data: {
        address,
        reputationScore: 62,
        tier: 'SILVER',
        kycVerified: true,
        deliveriesCompleted: 4,
        legacyDeliveriesCompleted: 2,
        registeredAt: new Date(),
      },
    });
    return address;
  }

  it('gets a single driver profile by address', async () => {
    const address = await seedDriverProfile();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/drivers/${address}/reputation`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ tier: string; reputationScore: number }>>();
    expect(body.data.tier).toBe('SILVER');
    expect(body.data.reputationScore).toBe(62);
  });

  it('returns 404 for an unregistered driver address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/drivers/${'G'.padEnd(56, 'Z')}/reputation`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/register-driver',
      payload: { driverAddress: 'G'.padEnd(56, 'A') },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects non-admin users from update-driver-kyc-status endpoint with 403', async () => {
    const customer = await registerAndLogin('CUSTOMER');
    const adminAddress = Keypair.random().publicKey();
    const driverAddress = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/update-driver-kyc-status',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: {
        adminAddress,
        driverAddress,
        kycVerified: true,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('allows admin users to access update-driver-kyc-status endpoint', async () => {
    const admin = await registerAndLogin('ADMIN');
    const adminAddress = Keypair.random().publicKey();
    const driverAddress = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/update-driver-kyc-status',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        adminAddress,
        driverAddress,
        kycVerified: true,
      },
    });

    expect([200, 502]).toContain(response.statusCode);
  });

  it('allows non-admin users to access register-driver endpoint', async () => {
    const customer = await registerAndLogin('CUSTOMER');
    const driverAddress = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/register-driver',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: { driverAddress },
    });

    expect([200, 502]).toContain(response.statusCode);
  });
});
