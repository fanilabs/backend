import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createResetPasswordUseCase } from '../application/reset-password.js';
import { createLoginUseCase } from '../application/login.js';
import { createPrismaAuthUnitOfWork } from './prisma-auth-unit-of-work.js';
import { createPrismaRefreshTokenRepository } from './prisma-refresh-token-repository.js';
import { createPrismaUserRepository } from './prisma-user-repository.js';
import { createJwtTokenService } from './jwt-token-service.js';
import { authenticate } from '../../../shared/http/plugins/auth-guard.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
import { writeAuthContext, readAuthContext } from '../../../shared/cache/index.js';
import { getRedisClient } from '../../../shared/cache/redis-client.js';

vi.mock('../../../shared/cache/redis-client.js', async () => {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(
    process.env.SECURITY_TEST_REDIS_SOCKET ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
    {
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    },
  );
  return { getRedisClient: () => redis, disconnectRedis: () => redis.disconnect() };
});
const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const tokens = createJwtTokenService();
const hasher = {
  async hash(value: string) {
    return `hashed:${value}`;
  },
  async compare(value: string, hash: string) {
    return hash === `hashed:${value}`;
  },
};
const reset = createResetPasswordUseCase({
  unitOfWork: createPrismaAuthUnitOfWork(prisma),
  tokenService: tokens,
  passwordHasher: hasher,
});
const request = (token: string) =>
  ({ headers: { authorization: `Bearer ${token}` } }) as FastifyRequest;
const reply = {} as FastifyReply;
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await disconnectPrisma();
  getRedisClient().disconnect();
});

async function setup() {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@reset.invalid`, passwordHash: 'hashed:old' },
  });
  createdUserIds.push(user.id);
  const refresh = tokens.issueRefreshToken(user);
  const row = await createPrismaRefreshTokenRepository(prisma).create({
    userId: user.id,
    ...refresh,
  });
  const access = tokens.issueAccessToken(user);
  await writeAuthContext(user.id, { role: user.role, tokenVersion: user.tokenVersion });
  return { user, refresh, row, access, resetToken: tokens.issuePasswordResetToken(user) };
}

describe('atomic reset with authoritative authentication', () => {
  it('rejects old access despite populated Redis and a delayed stale refill', async () => {
    const { user, access, row, resetToken } = await setup();
    expect(await readAuthContext(user.id)).toMatchObject({ tokenVersion: 0 });
    await authenticate(request(access), reply);
    await reset({ token: resetToken, newPassword: 'new' });
    // A different/lagging instance writes its previously-read context after commit.
    await writeAuthContext(user.id, { role: 'ADMIN', tokenVersion: 0 });
    expect(await readAuthContext(user.id)).toMatchObject({ tokenVersion: 0 });
    await expect(authenticate(request(access), reply)).rejects.toThrow(
      'Invalid or expired access token',
    );
    const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(
      authenticate(request(tokens.issueAccessToken(current)), reply),
    ).resolves.toBeUndefined();
    expect(await prisma.sessionFamily.findUnique({ where: { id: row.familyId! } })).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });

  it('rejects pre-reset access in a separate application process', async () => {
    const { user, access, resetToken } = await setup();
    await reset({ token: resetToken, newPassword: 'new' });
    await writeAuthContext(user.id, { role: user.role, tokenVersion: 0 });
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      const { authenticate } = await import('./src/shared/http/plugins/auth-guard.ts');
      const { disconnectPrisma } = await import('./src/shared/database/index.ts');
      try {
        await authenticate({ headers: { authorization: 'Bearer ' + process.env.SECURITY_TEST_ACCESS } }, {});
        process.exitCode = 1;
      } catch (error) {
        if (error.message !== 'Invalid or expired access token') throw error;
        console.log('revoked');
      } finally { await disconnectPrisma(); }
    `,
      ],
      { env: { ...process.env, SECURITY_TEST_ACCESS: access }, encoding: 'utf8' },
    );
    expect(output.trim()).toBe('revoked');
  });

  it('rejects old access even when Redis reads and eviction fail', async () => {
    const { access, resetToken } = await setup();
    const redis = getRedisClient();
    const get = vi.spyOn(redis, 'get').mockRejectedValue(new Error('cache unavailable'));
    const del = vi.spyOn(redis, 'del').mockRejectedValue(new Error('eviction unavailable'));
    try {
      await reset({ token: resetToken, newPassword: 'new' });
      await expect(authenticate(request(access), reply)).rejects.toThrow(
        'Invalid or expired access token',
      );
      expect(get).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      del.mockRestore();
    }
  });

  it('rolls back password, revocations and version together and preserves old access', async () => {
    const { user, access, row, resetToken } = await setup();
    const atomic = createPrismaAuthUnitOfWork(prisma);
    const failing = createResetPasswordUseCase({
      tokenService: tokens,
      passwordHasher: hasher,
      unitOfWork: {
        run: (id, work) =>
          atomic.run(id, async (ports) => {
            await work(ports);
            throw new Error('precommit failure');
          }),
      },
    });
    await expect(failing({ token: resetToken, newPassword: 'new' })).rejects.toThrow(
      'precommit failure',
    );
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      passwordHash: 'hashed:old',
      tokenVersion: 0,
    });
    expect(await prisma.sessionFamily.findUnique({ where: { id: row.familyId! } })).toMatchObject({
      revokedAt: null,
    });
    expect(await prisma.refreshToken.findUnique({ where: { id: row.id } })).toMatchObject({
      revokedAt: null,
    });
    await expect(authenticate(request(access), reply)).resolves.toBeUndefined();
  });

  it('permits only one concurrent use of a reset link', async () => {
    const { user, resetToken } = await setup();
    const results = await Promise.allSettled([
      reset({ token: resetToken, newPassword: 'first' }),
      reset({ token: resetToken, newPassword: 'second' }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      tokenVersion: 1,
    });
  });

  it('rechecks a pending login password after reset instead of issuing a new family', async () => {
    const { user, resetToken } = await setup();
    const users = createPrismaUserRepository(prisma);
    const login = createLoginUseCase({
      userRepository: {
        ...users,
        async findByEmail(email) {
          const stale = await users.findByEmail(email);
          await reset({ token: resetToken, newPassword: 'new' });
          return stale;
        },
      },
      unitOfWork: createPrismaAuthUnitOfWork(prisma),
      tokenService: tokens,
      passwordHasher: hasher,
    });
    await expect(login({ email: user.email, password: 'old' })).rejects.toThrow();
    expect(await prisma.sessionFamily.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });
});
