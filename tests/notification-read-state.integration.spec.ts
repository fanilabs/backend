import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGetNotificationUseCase,
  createListNotificationsUseCase,
  createMarkNotificationsReadUseCase,
} from '../src/modules/notifications/application/index.js';
import { createPrismaNotificationRepository } from '../src/modules/notifications/infrastructure/prisma-notification-repository.js';
import { createNotificationsRoutes } from '../src/modules/notifications/interface/routes.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { handleError } from '../src/shared/errors/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';

// Real routes, use cases, primary-database authentication and repository.
// No worker, mail transport or full-app initialization is needed for read state.
const prisma = new PrismaClient();
const repository = createPrismaNotificationRepository(prisma);
const app = Fastify();
const users: string[] = [];
let owner: string;
let other: string;
let unreadId: string;
let readId: string;
let otherId: string;
let revokedToken: string;
const originalReadAt = new Date('2026-01-01T00:00:00.123Z');
function headers(id: string) {
  return {
    authorization: `Bearer ${signAccessToken({ sub: id, role: 'CUSTOMER', tokenVersion: 0 })}`,
  };
}

beforeAll(async () => {
  for (let index = 0; index < 2; index++) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@read-state.invalid`, passwordHash: 'fixture-only' },
    });
    users.push(user.id);
  }
  const [first, second] = users;
  if (!first || !second) throw new Error('Missing test users');
  owner = first;
  other = second;
  const unread = await repository.create({
    userId: owner,
    channel: 'EMAIL',
    type: 'pending',
    payload: {},
  });
  unreadId = unread.id;
  const read = await prisma.notification.create({
    data: {
      userId: owner,
      channel: 'PUSH',
      type: 'read',
      payload: {},
      readAt: originalReadAt,
      status: 'SENT',
    },
  });
  readId = read.id;
  const theirs = await repository.create({
    userId: other,
    channel: 'SMS',
    type: 'other',
    payload: {},
  });
  otherId = theirs.id;
  revokedToken = signAccessToken({ sub: owner, role: 'CUSTOMER', tokenVersion: -1 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(
    createNotificationsRoutes({
      getNotification: createGetNotificationUseCase({ notificationRepository: repository }),
      listNotifications: createListNotificationsUseCase({ notificationRepository: repository }),
      markNotificationsRead: createMarkNotificationsReadUseCase({
        notificationRepository: repository,
      }),
    }),
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  await disconnectPrisma();
});

describe('persisted notification read contract', () => {
  it('round-trips null and real timestamps through detail and list without marking reads', async () => {
    expect((await repository.findById(unreadId))?.readAt).toBeNull();
    const detail = await app.inject({ url: `/notifications/${readId}`, headers: headers(owner) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.readAt).toBe(originalReadAt.toISOString());
    const list = await app.inject({ url: '/notifications', headers: headers(owner) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(2);
    expect(list.json().data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: unreadId, readAt: null })]),
    );
    expect((await repository.findById(unreadId))?.readAt).toBeNull();
  });

  it('rejects unauthenticated and version-revoked marking without writes', async () => {
    for (const auth of [undefined, `Bearer ${revokedToken}`]) {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/mark-read',
        ...(auth ? { headers: { authorization: auth } } : {}),
      });
      expect(response.statusCode).toBe(401);
    }
    expect((await repository.findById(unreadId))?.readAt).toBeNull();
  });

  it('retains detail ownership and missing-record errors', async () => {
    expect(
      (await app.inject({ url: `/notifications/${otherId}`, headers: headers(owner) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `/notifications/${randomUUID()}`, headers: headers(owner) }))
        .statusCode,
    ).toBe(404);
  });

  it('marks only owner unread rows with an actual action timestamp and is idempotent', async () => {
    const before = await prisma.notification.findMany({ where: { userId: owner } });
    const start = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/notifications/mark-read',
      headers: headers(owner),
      payload: { userId: other },
    });
    const end = Date.now();
    expect(response.statusCode).toBe(200);
    expect(response.json().data.count).toBe(1);
    const marked = await repository.findById(unreadId);
    expect(marked?.readAt?.getTime()).toBeGreaterThanOrEqual(start);
    expect(marked?.readAt?.getTime()).toBeLessThanOrEqual(end);
    expect((await repository.findById(readId))?.readAt).toEqual(originalReadAt);
    expect((await repository.findById(otherId))?.readAt).toBeNull();
    const again = await app.inject({
      method: 'POST',
      url: '/notifications/mark-read',
      headers: headers(owner),
    });
    expect(again.json().data.count).toBe(0);
    expect((await repository.findById(unreadId))?.readAt).toEqual(marked?.readAt);
    const after = await prisma.notification.findMany({ where: { userId: owner } });
    for (const row of before) {
      const current = after.find(({ id }) => id === row.id);
      if (!current) throw new Error('Missing notification after mark-read');
      const { readAt: _oldRead, updatedAt: _oldUpdate, ...oldValues } = row;
      const { readAt: _newRead, updatedAt: _newUpdate, ...newValues } = current;
      expect(newValues).toEqual(oldValues);
    }
  });

  it('keeps delivery status changes separate from read state and new rows unread', async () => {
    const fresh = await repository.create({
      userId: owner,
      channel: 'EMAIL',
      type: 'new',
      payload: {},
    });
    expect(fresh.readAt).toBeNull();
    await repository.markSent(fresh.id, new Date());
    expect((await repository.findById(fresh.id))?.readAt).toBeNull();
    await repository.markFailed(fresh.id, 'fixture failure');
    expect((await repository.findById(fresh.id))?.readAt).toBeNull();
    expect((await repository.findById(readId))?.readAt).toEqual(originalReadAt);
  });
});
