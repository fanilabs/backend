import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { getPrismaClient, disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';
import { createPrismaNotificationRepository } from '../infrastructure/prisma-notification-repository.js';

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

  it('rejects an unauthenticated request for a single notification', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated mark-read request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/mark-read',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it("marks all of the requesting user's unread notifications as read", async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        userId,
        channel: 'EMAIL' as const,
        type: `mark-read-${index}`,
        payload: {},
      })),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/mark-read',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<SuccessBody<{ count: number }>>().data.count).toBe(5);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const notifications = listed.json<SuccessBody<Array<{ readAt: string | null }>>>().data;
    expect(notifications).toHaveLength(5);
    expect(notifications.every((notification) => notification.readAt !== null)).toBe(true);
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

  it('filters to unread notifications when unread=true', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'unread-a', payload: {} },
    });
    const read = await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'read-b', payload: {} },
    });
    await prisma.notification.update({
      where: { id: read.id },
      data: { readAt: new Date() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ readAt: string | null; type: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.readAt).toBeNull();
    expect(body.data[0]?.type).toBe('unread-a');
  });

  it('filters to read notifications when unread=false', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'unread-c', payload: {} },
    });
    const read = await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'read-d', payload: {} },
    });
    await prisma.notification.update({
      where: { id: read.id },
      data: { readAt: new Date() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=false',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ readAt: string | null; type: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.readAt).not.toBeNull();
    expect(body.data[0]?.type).toBe('read-d');
  });

  it('filters by channel via the query string', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'ch-email', payload: {} },
    });
    await prisma.notification.create({
      data: { userId, channel: 'SMS', type: 'ch-sms', payload: {} },
    });
    await prisma.notification.create({
      data: { userId, channel: 'PUSH', type: 'ch-push', payload: {} },
    });

    const emailResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?channel=EMAIL',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(emailResponse.statusCode).toBe(200);
    const emailBody = emailResponse.json<SuccessBody<Array<{ channel: string }>>>();
    expect(emailBody.data).toHaveLength(1);
    expect(emailBody.data[0]?.channel).toBe('EMAIL');

    const smsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?channel=SMS',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(smsResponse.statusCode).toBe(200);
    const smsBody = smsResponse.json<SuccessBody<Array<{ channel: string }>>>();
    expect(smsBody.data).toHaveLength(1);
    expect(smsBody.data[0]?.channel).toBe('SMS');
  });

  it('composes unread and channel filters together', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    // unread EMAIL — should be the only match
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'combo-match', payload: {} },
    });
    // read EMAIL
    const readEmail = await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'combo-read', payload: {} },
    });
    await prisma.notification.update({ where: { id: readEmail.id }, data: { readAt: new Date() } });
    // unread SMS
    await prisma.notification.create({
      data: { userId, channel: 'SMS', type: 'combo-sms', payload: {} },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true&channel=EMAIL',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ channel: string; readAt: string | null; type: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.channel).toBe('EMAIL');
    expect(body.data[0]?.readAt).toBeNull();
    expect(body.data[0]?.type).toBe('combo-match');
  });

  it('rejects an invalid channel value with a validation error', async () => {
    const { accessToken } = await registerAndLogin();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?channel=CARRIER_PIGEON',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid unread value with a validation error', async () => {
    const { accessToken } = await registerAndLogin();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=maybe',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('never returns another user\'s notifications even when channel and unread filters match', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const { userId: otherId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.create({
      data: { userId, channel: 'EMAIL', type: 'isolation-mine', payload: {} },
    });
    await prisma.notification.create({
      data: { userId: otherId, channel: 'EMAIL', type: 'isolation-other', payload: {} },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true&channel=EMAIL',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ type: string }>>>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.type).toBe('isolation-mine');
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

  it('returns the persisted failure reason for a failed notification', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    const created = await prisma.notification.create({
      data: {
        userId,
        channel: 'EMAIL',
        type: 'fleet.driver_invited',
        payload: {},
      },
    });
    const notificationRepository = createPrismaNotificationRepository(prisma);
    await notificationRepository.markFailed(created.id, 'Invalid SMTP address');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications/${created.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<SuccessBody<{ status: string; failureReason: string }>>().data,
    ).toMatchObject({
      status: 'FAILED',
      failureReason: 'Invalid SMTP address',
    });
  });

  // #673 — the response DTO's channel enum (`EMAIL`/`SMS`/`PUSH`) mirrors
  // every value the `channel` column can actually hold, but every other
  // fixture here only ever persists `EMAIL` rows. These seed SMS/PUSH rows
  // directly (inert payloads, no delivery worker involved) so the read path
  // is proven for every persisted channel, not just the one this module can
  // currently send.
  it('lists persisted SMS and PUSH notifications alongside EMAIL ones', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const prisma = getPrismaClient();
    await prisma.notification.createMany({
      data: [
        { userId, channel: 'EMAIL' as const, type: 'channel-coverage.email', payload: {} },
        { userId, channel: 'SMS' as const, type: 'channel-coverage.sms', payload: {} },
        { userId, channel: 'PUSH' as const, type: 'channel-coverage.push', payload: {} },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ channel: string; type: string }>>>();
    const channelsByType = new Map(body.data.map((n) => [n.type, n.channel]));
    expect(channelsByType.get('channel-coverage.email')).toBe('EMAIL');
    expect(channelsByType.get('channel-coverage.sms')).toBe('SMS');
    expect(channelsByType.get('channel-coverage.push')).toBe('PUSH');
  });

  it.each(['SMS', 'PUSH'] as const)(
    'gets a single persisted %s notification by id',
    async (channel) => {
      const { accessToken, userId } = await registerAndLogin();
      const created = await getPrismaClient().notification.create({
        data: { userId, channel, type: `single-read.${channel.toLowerCase()}`, payload: {} },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notifications/${created.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(
        response.json<SuccessBody<{ channel: string; type: string }>>().data,
      ).toMatchObject({ channel, type: `single-read.${channel.toLowerCase()}` });
    },
  );

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
