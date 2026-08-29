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

/**
 * End-to-end API tests through the real, fully-wired app (real Prisma-backed
 * repositories, real bcrypt, real JWTs) — this is deliberately not testing
 * against fakes, since the point is to verify the actual composition root
 * in src/modules/auth/index.ts, not just the use cases in isolation (those
 * already have their own fast unit tests). Skipped, not failed, without a
 * reachable database — see src/shared/testing/database.ts.
 */
describe.skipIf(!dbAvailable)('auth routes (integration)', () => {
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

  function uniqueEmail(): string {
    const email = `routes-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    return email;
  }

  it('registers a new user', async () => {
    const email = uniqueEmail();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<SuccessBody<{ userId: string }>>();
    expect(body.data.userId).toBeTruthy();
  });

  it('rejects a duplicate registration with 409 CONFLICT', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONFLICT');
  });

  it('rejects an invalid email with 400 VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'password123' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    expect(good.statusCode).toBe(200);
    const body = good.json<SuccessBody<{ accessToken: string; refreshToken: string }>>();
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const email = uniqueEmail();
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
    const { refreshToken } = login.json<SuccessBody<{ refreshToken: string }>>().data;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);

    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(reused.statusCode).toBe(401);
  });

  it('logs out and always returns success for a password reset request', async () => {
    const email = uniqueEmail();
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
    const { refreshToken } = login.json<SuccessBody<{ refreshToken: string }>>().data;

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(200);

    const requestReset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/request-password-reset',
      payload: { email: 'unregistered-address@example.com' },
    });
    expect(requestReset.statusCode).toBe(200);
  });

  it('rejects a garbage email verification token with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an email-verification token when presented as Bearer access token to a protected route', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    const prisma = getPrismaClient();
    const tokenService = (await import('../infrastructure/jwt-token-service.js')).createJwtTokenService();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const emailVerificationToken = tokenService.issueEmailVerificationToken(user);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${emailVerificationToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a password-reset token when presented as Bearer access token to a protected route', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    const prisma = getPrismaClient();
    const tokenService = (await import('../infrastructure/jwt-token-service.js')).createJwtTokenService();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const passwordResetToken = tokenService.issuePasswordResetToken(user);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${passwordResetToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wallet-link challenge token when presented as Bearer access token to a protected route', async () => {
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });

    const prisma = getPrismaClient();
    const challengeService = (await import('../../users/infrastructure/jwt-challenge-service.js')).createJwtChallengeService();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const walletLinkChallenge = challengeService.issueWalletLinkChallenge(user.id, 'GXXXXXX');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${walletLinkChallenge}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });
});
