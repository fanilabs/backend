import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { getPrismaClient, disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';
import { config } from '../../../shared/config/index.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const NON_DEFAULT_TTL_SECONDS = 137;
const LARGE_GMV_AMOUNT = '9007199254740993';

describe.skipIf(!dbAvailable)('analytics routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const createdEmails: string[] = [];
  const originalCacheTtl = config.analytics.cacheTtlSeconds;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterEach(() => {
    config.analytics.cacheTtlSeconds = originalCacheTtl;
  });

  afterAll(async () => {
    config.analytics.cacheTtlSeconds = originalCacheTtl;
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
    config.analytics.cacheTtlSeconds = NON_DEFAULT_TTL_SECONDS;
    const expectedCacheControl = `private, max-age=${NON_DEFAULT_TTL_SECONDS}`;
    const accessToken = await registerAndLogin('ADMIN');
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const gmv = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/gmv',
      headers: authHeader,
    });
    expect(gmv.statusCode).toBe(200);
    expect(gmv.headers['cache-control']).toBe(expectedCacheControl);
    expect(Array.isArray(gmv.json<SuccessBody<unknown[]>>().data)).toBe(true);

    const completion = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/completion-rate',
      headers: authHeader,
    });
    expect(completion.statusCode).toBe(200);
    expect(completion.headers['cache-control']).toBe(expectedCacheControl);
    expect(completion.json<SuccessBody<{ completionRate: number }>>().data).toHaveProperty(
      'completionRate',
    );

    const disputeRate = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/dispute-rate',
      headers: authHeader,
    });
    expect(disputeRate.statusCode).toBe(200);
    expect(disputeRate.headers['cache-control']).toBe(expectedCacheControl);
    expect(disputeRate.json<SuccessBody<{ disputeRate: number }>>().data).toHaveProperty(
      'disputeRate',
    );

    const tiers = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/driver-tiers',
      headers: authHeader,
    });
    expect(tiers.statusCode).toBe(200);
    expect(tiers.headers['cache-control']).toBe(expectedCacheControl);
    expect(tiers.json<SuccessBody<{ total: number }>>().data).toHaveProperty('total');
  });

  it('serializes a GMV amount above Number.MAX_SAFE_INTEGER as an exact decimal string', async () => {
    const accessToken = await registerAndLogin('ADMIN');
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const gmv = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/gmv',
      headers: authHeader,
    });
    expect(gmv.statusCode).toBe(200);

    const rawBody = gmv.body;
    expect(rawBody).toContain(`"releasedAmount":"${LARGE_GMV_AMOUNT}"`);
    expect(rawBody).not.toContain(`"releasedAmount":${LARGE_GMV_AMOUNT}`);

    const rows = gmv.json<SuccessBody<Array<{ releasedAmount: string }>>>().data;
    const matching = rows.find((row) => row.releasedAmount === LARGE_GMV_AMOUNT);
    expect(matching).toBeDefined();
    expect(typeof matching?.releasedAmount).toBe('string');
  });
});
