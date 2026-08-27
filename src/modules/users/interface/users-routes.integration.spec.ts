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

describe.skipIf(!dbAvailable)('users routes (integration)', () => {
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
      await prisma.walletAddress.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectPrisma();
  });

  async function registerAndLogin(): Promise<string> {
    const email = `users-test-${randomUUID()}@example.com`;
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
    return login.json<SuccessBody<{ accessToken: string }>>().data.accessToken;
  }

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/users/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('returns the authenticated user’s profile with no wallets initially', async () => {
    const accessToken = await registerAndLogin();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ wallets: unknown[] }>>();
    expect(body.data.wallets).toEqual([]);
  });

  it('links a wallet end-to-end with a real Stellar signature, then lists and unlinks it', async () => {
    const accessToken = await registerAndLogin();
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    expect(challengeResponse.statusCode).toBe(200);
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;

    const signature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature },
    });
    expect(confirmResponse.statusCode).toBe(200);
    const wallet =
      confirmResponse.json<SuccessBody<{ id: string; address: string; isPrimary: boolean }>>().data;
    expect(wallet.address).toBe(address);
    expect(wallet.isPrimary).toBe(true);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/wallets',
      headers: authHeader,
    });
    expect(listResponse.json<SuccessBody<unknown[]>>().data).toHaveLength(1);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/me/wallets/${wallet.id}`,
      headers: authHeader,
    });
    expect(deleteResponse.statusCode).toBe(200);

    const listAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/wallets',
      headers: authHeader,
    });
    expect(listAfterDelete.json<SuccessBody<unknown[]>>().data).toHaveLength(0);
  });

  it('rejects confirming a wallet link with a forged signature', async () => {
    const accessToken = await registerAndLogin();
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;

    // Signed by a *different* keypair than the one whose address is claimed.
    const impostor = Keypair.random();
    const forgedSignature = impostor.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature: forgedSignature },
    });

    expect(confirmResponse.statusCode).toBe(401);
  });
});
