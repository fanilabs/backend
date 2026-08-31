import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { getPrismaClient, disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('analytics routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdEmails.length > 0) {
      const prisma = getPrismaClient();
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectPrisma();
  });

  async function registerAndLogin(role: 'CUSTOMER' | 'ADMIN'): Promise<string> {
    const email = `analytics-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    if (role === 'ADMIN') {
      await getPrismaClient().user.update({ where: { email }, data: { role: 'ADMIN' } });
    }
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json<SuccessBody<{ accessToken: string }>>().data.accessToken;
  }

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/analytics/gmv' });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-admin authenticated request', async () => {
    const accessToken = await registerAndLogin('CUSTOMER');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/completion-rate',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('serves aggregate metrics to an admin', async () => {
    const accessToken = await registerAndLogin('ADMIN');
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const gmv = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/gmv',
      headers: authHeader,
    });
    expect(gmv.statusCode).toBe(200);
    expect(Array.isArray(gmv.json<SuccessBody<unknown[]>>().data)).toBe(true);

    const completion = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/completion-rate',
      headers: authHeader,
    });
    expect(completion.statusCode).toBe(200);
    expect(completion.json<SuccessBody<{ completionRate: number }>>().data).toHaveProperty(
      'completionRate',
    );

    const disputeRate = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/dispute-rate',
      headers: authHeader,
    });
    expect(disputeRate.statusCode).toBe(200);
    expect(disputeRate.json<SuccessBody<{ disputeRate: number }>>().data).toHaveProperty(
      'disputeRate',
    );

    const tiers = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/driver-tiers',
      headers: authHeader,
    });
    expect(tiers.statusCode).toBe(200);
    expect(tiers.json<SuccessBody<{ total: number }>>().data).toHaveProperty('total');
  });
});
