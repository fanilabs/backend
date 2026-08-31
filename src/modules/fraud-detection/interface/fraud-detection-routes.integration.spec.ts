import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { getPrismaClient, disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}

describe.skipIf(!dbAvailable)('fraud-detection routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const createdEmails: string[] = [];
  const createdAddresses: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    const prisma = getPrismaClient();
    if (createdAddresses.length > 0) {
      await prisma.actorActivity.deleteMany({ where: { address: { in: createdAddresses } } });
    }
    if (createdEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectPrisma();
  });

  async function registerAndLoginAdmin(): Promise<string> {
    const email = `fraud-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    await getPrismaClient().user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json<SuccessBody<{ accessToken: string }>>().data.accessToken;
  }

  it('rejects an unauthenticated request', async () => {
    const address = Keypair.random().publicKey();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/fraud-detection/actors/${address}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('flags an actor whose logged activity exceeds a rule threshold', async () => {
    const accessToken = await registerAndLoginAdmin();
    const address = Keypair.random().publicKey();
    createdAddresses.push(address);
    const prisma = getPrismaClient();
    await prisma.actorActivity.createMany({
      data: Array.from({ length: 11 }, () => ({
        address,
        category: 'DELIVERY_CREATED' as const,
        occurredAt: new Date(),
      })),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/fraud-detection/actors/${address}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body =
      response.json<
        SuccessBody<{ flagged: boolean; signals: Array<{ ruleType: string; triggered: boolean }> }>
      >();
    expect(body.data.flagged).toBe(true);
    expect(
      body.data.signals.find((s) => s.ruleType === 'DELIVERY_CREATION_VELOCITY')?.triggered,
    ).toBe(true);
  });

  it('returns not-flagged for an actor with no recorded activity', async () => {
    const accessToken = await registerAndLoginAdmin();
    const address = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/fraud-detection/actors/${address}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<SuccessBody<{ flagged: boolean }>>().data.flagged).toBe(false);
  });
});
