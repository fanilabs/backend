import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createRefreshSessionUseCase } from '../application/refresh-session.js';
import { createPrismaAuthUnitOfWork } from './prisma-auth-unit-of-work.js';
import { createPrismaRefreshTokenRepository } from './prisma-refresh-token-repository.js';
import { createJwtTokenService } from './jwt-token-service.js';

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const tokens = createJwtTokenService();
const clients: PrismaClient[] = [prisma];
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  for (const client of clients) await client.$disconnect();
});

async function session() {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@security.invalid`, passwordHash: 'test-hash' },
  });
  createdUserIds.push(user.id);
  const issued = tokens.issueRefreshToken(user);
  const repo = createPrismaRefreshTokenRepository(prisma);
  const row = await repo.create({ userId: user.id, ...issued });
  const refresh = createRefreshSessionUseCase({
    unitOfWork: createPrismaAuthUnitOfWork(prisma),
    tokenService: tokens,
    clock: { now: () => new Date() },
  });
  return { user, issued, repo, row, refresh };
}

describe('persistent session family rotation', () => {
  it('serializes simultaneous reuse, revokes the winner and preserves unrelated logins', async () => {
    const { user, issued, repo, row, refresh } = await session();
    const other = tokens.issueRefreshToken(user);
    const independent = await repo.create({ userId: user.id, ...other });
    const attempts = await Promise.allSettled([
      refresh({ refreshToken: issued.token }),
      refresh({ refreshToken: issued.token }),
    ]);
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.refreshToken.count({ where: { familyId: row.familyId, revokedAt: null } }),
    ).toBe(0);
    const winner = attempts.find((x) => x.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Expected winning response');
    await expect(refresh({ refreshToken: winner.value.refreshToken })).rejects.toThrow();
    expect(await repo.isFamilyActive(independent.familyId!)).toBe(true);
    await expect(refresh({ refreshToken: other.token })).resolves.toHaveProperty('refreshToken');
  });

  it('persists replay revocation across fresh clients and invalidates every descendant', async () => {
    const { issued, row, refresh } = await session();
    const first = await refresh({ refreshToken: issued.token });
    const second = await refresh({ refreshToken: first.refreshToken });
    const client = new PrismaClient();
    clients.push(client);
    const restarted = createRefreshSessionUseCase({
      unitOfWork: createPrismaAuthUnitOfWork(client),
      tokenService: createJwtTokenService(),
      clock: { now: () => new Date() },
    });
    await expect(restarted({ refreshToken: issued.token })).rejects.toThrow();
    expect(await client.sessionFamily.findUnique({ where: { id: row.familyId! } })).toMatchObject({
      revokedAt: expect.any(Date),
    });
    await expect(restarted({ refreshToken: second.refreshToken })).rejects.toThrow();
  });

  it('rejects a revoked successor in a completely new process', async () => {
    const { issued, refresh } = await session();
    const successor = await refresh({ refreshToken: issued.token });
    await expect(refresh({ refreshToken: issued.token })).rejects.toThrow();
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      const { PrismaClient } = await import('@prisma/client');
      const { createPrismaAuthUnitOfWork } = await import('./src/modules/auth/infrastructure/prisma-auth-unit-of-work.ts');
      const { createRefreshSessionUseCase } = await import('./src/modules/auth/application/refresh-session.ts');
      const { createJwtTokenService } = await import('./src/modules/auth/infrastructure/jwt-token-service.ts');
      const prisma = new PrismaClient();
      try {
        const refresh = createRefreshSessionUseCase({ unitOfWork: createPrismaAuthUnitOfWork(prisma), tokenService: createJwtTokenService(), clock: { now: () => new Date() } });
        await refresh({ refreshToken: process.env.SECURITY_TEST_REFRESH });
        process.exitCode = 1;
      } catch (error) {
        if (error.code !== 'UNAUTHORIZED' || error.message !== 'Refresh token is invalid, expired, or has been revoked') throw error;
        console.log('revoked');
      } finally { await prisma.$disconnect(); }
    `,
      ],
      { env: { ...process.env, SECURITY_TEST_REFRESH: successor.refreshToken }, encoding: 'utf8' },
    );
    expect(output.trim()).toBe('revoked');
  });

  it('rolls back consumption if successor persistence fails', async () => {
    const { issued, repo, row } = await session();
    // The existing token hash forces the real unique constraint to reject the insert.
    const refresh = createRefreshSessionUseCase({
      unitOfWork: createPrismaAuthUnitOfWork(prisma),
      tokenService: { ...tokens, issueRefreshToken: () => issued },
      clock: { now: () => new Date() },
    });
    await expect(refresh({ refreshToken: issued.token })).rejects.toThrow();
    expect(await repo.findByTokenHash(issued.tokenHash)).toMatchObject({ revokedAt: null });
    expect(await repo.isFamilyActive(row.familyId!)).toBe(true);
    expect(await prisma.refreshToken.count({ where: { familyId: row.familyId } })).toBe(1);
  });

  it('rejects historical unassigned sessions without inventing ancestry', async () => {
    const { user, refresh } = await session();
    const legacy = tokens.issueRefreshToken(user);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: legacy.tokenHash, expiresAt: legacy.expiresAt },
    });
    await expect(refresh({ refreshToken: legacy.token })).rejects.toThrow();
  });

  it('rolls back both family revocation and consumption on transaction failure', async () => {
    const { user, issued, row, repo } = await session();
    await expect(
      createPrismaAuthUnitOfWork(prisma).run(user.id, async (ports) => {
        await ports.refreshTokenRepository.revokeFamily(row.familyId!);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(await repo.isFamilyActive(row.familyId!)).toBe(true);
    expect(await repo.findByTokenHash(issued.tokenHash)).toMatchObject({ revokedAt: null });
  });
});
