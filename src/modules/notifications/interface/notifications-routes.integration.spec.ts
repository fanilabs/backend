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

describe.skipIf(!dbAvailable)('notifications routes (integration)', () => {
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
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectPrisma();
  });

  async function registerAndLogin(): Promise<{ accessToken: string; userId: string }> {
    const email = `notifications-test-${randomUUID()}@example.com`;
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
    const accessToken = login.json<SuccessBody<{ accessToken: string }>>().data.accessToken;
    const user = await getPrismaClient().user.findUniqueOrThrow({ where: { email } });
    return { accessToken, userId: user.id };
  }

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/notifications' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it("lists only the requesting user's own notifications", async () => {
    const { accessToken, userId } = await registerAndLogin();
    const { userId: otherUserId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'delivery.driver_assigned', payload: {} },
    });
    await prisma.notification.create({
      data: {
        userId: otherUserId,
        channel: 'EMAIL',
        type: 'delivery.driver_assigned',
        payload: {},
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ id: string }>>>();
    expect(body.data).toHaveLength(1);
  });

  it('filters by status via the query string', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'a', payload: {}, status: 'SENT' },
    });
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'b', payload: {}, status: 'PENDING' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?status=SENT',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ status: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.status).toBe('SENT');
  });

  it('gets a single notification by id', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const created = await getPrismaClient().notification.create({
      data: {
        userId,
        channel: 'EMAIL',
        type: 'fleet.driver_invited',
        payload: { chainFleetId: '1' },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications/${created.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<SuccessBody<{ type: string }>>().data.type).toBe('fleet.driver_invited');
  });

  it('returns 404 for an unknown notification id', async () => {
    const { accessToken } = await registerAndLogin();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications/${randomUUID()}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it("returns 403 for another user's notification", async () => {
    const { accessToken } = await registerAndLogin();
    const { userId: otherUserId } = await registerAndLogin();
    const created = await getPrismaClient().notification.create({
      data: { userId: otherUserId, channel: 'EMAIL', type: 'a', payload: {} },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications/${created.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });
});
