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
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('admin routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const createdEmails: string[] = [];
  const createdChainIds: bigint[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    const prisma = getPrismaClient();
    if (createdChainIds.length > 0) {
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    if (createdEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectPrisma();
  });

  async function registerAndLogin(role: 'CUSTOMER' | 'ADMIN'): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const email = `admin-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    const prisma = getPrismaClient();
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

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/disputes' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-admin authenticated request', async () => {
    const { accessToken } = await registerAndLogin('CUSTOMER');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/disputes',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('lists open disputes for review', async () => {
    const { accessToken } = await registerAndLogin('ADMIN');
    const prisma = getPrismaClient();
    const chainDeliveryId =
      BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1e6));
    createdChainIds.push(chainDeliveryId);
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        status: 'DISPUTED',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    await prisma.dispute.create({
      data: { chainDeliveryId, status: 'OPEN', raisedBy: 'GRAISER', raisedAt: new Date() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/disputes',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<Array<{ chainDeliveryId: string }>>>();
    expect(body.data.some((d) => d.chainDeliveryId === chainDeliveryId.toString())).toBe(true);
  });

  it('updates a user role and records an audit log entry, visible via GET /admin/audit-log', async () => {
    const admin = await registerAndLogin('ADMIN');
    const target = await registerAndLogin('CUSTOMER');
    const authHeader = { authorization: `Bearer ${admin.accessToken}` };

    const updateResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.userId}/role`,
      headers: authHeader,
      payload: { role: 'COURIER' },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json<SuccessBody<{ role: string }>>().data.role).toBe('COURIER');

    const auditResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?limit=200',
      headers: authHeader,
    });

    expect(auditResponse.statusCode).toBe(200);
    const entries =
      auditResponse.json<
        SuccessBody<Array<{ actorId: string; entityId: string; action: string }>>
      >().data;
    expect(
      entries.some(
        (e) =>
          e.actorId === admin.userId &&
          e.entityId === target.userId &&
          e.action === 'user.role_updated',
      ),
    ).toBe(true);
  });

  it('returns 404 for updating an unknown user', async () => {
    const admin = await registerAndLogin('ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${randomUUID()}/role`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('revokes refresh tokens when a user role is changed', async () => {
    const admin = await registerAndLogin('ADMIN');
    const target = await registerAndLogin('CUSTOMER');
    const authHeader = { authorization: `Bearer ${admin.accessToken}` };

    const originalRefreshToken = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: `admin-test-${randomUUID()}@example.com`,
          password: 'password123',
        },
      })
    ).json<SuccessBody<{ refreshToken: string }>>().data.refreshToken;

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.userId}/role`,
      headers: authHeader,
      payload: { role: 'ADMIN' },
    });

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: originalRefreshToken },
    });

    expect(refreshResponse.statusCode).toBe(401);
    expect(refreshResponse.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('records audit log entry when revoking sessions on role change', async () => {
    const admin = await registerAndLogin('ADMIN');
    const target = await registerAndLogin('CUSTOMER');
    const authHeader = { authorization: `Bearer ${admin.accessToken}` };

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.userId}/role`,
      headers: authHeader,
      payload: { role: 'COURIER' },
    });

    const auditResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?limit=200',
      headers: authHeader,
    });

    expect(auditResponse.statusCode).toBe(200);
    const entries = auditResponse.json<
      SuccessBody<Array<{ actorId: string; entityId: string; action: string }>>
    >().data;
    expect(
      entries.some(
        (e) =>
          e.actorId === admin.userId &&
          e.entityId === target.userId &&
          e.action === 'user.role_updated',
      ),
    ).toBe(true);
  });
});
