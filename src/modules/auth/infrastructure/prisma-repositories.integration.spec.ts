import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaUserRepository } from './prisma-user-repository.js';
import { createPrismaRefreshTokenRepository } from './prisma-refresh-token-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

/**
 * Real Postgres integration tests — no mocking at this layer (see
 * docs/DATABASE.md). Automatically skipped, not failed, where no database
 * is reachable (e.g. a sandbox without Docker); CI's Postgres service
 * container makes this suite run for real on every PR.
 */
describe.skipIf(!dbAvailable)('Prisma auth repositories (integration)', () => {
  const prisma = new PrismaClient();
  const userRepository = createPrismaUserRepository(prisma);
  const refreshTokenRepository = createPrismaRefreshTokenRepository(prisma);
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('creates a user and finds it by email and by id', async () => {
    const email = `test-${randomUUID()}@example.com`;

    const user = await userRepository.create({ email, passwordHash: 'hash', role: 'CUSTOMER' });
    createdUserIds.push(user.id);

    expect(await userRepository.findByEmail(email)).toMatchObject({ id: user.id, email });
    expect(await userRepository.findById(user.id)).toMatchObject({ id: user.id, email });
    expect(await userRepository.findByEmail(`nobody-${randomUUID()}@example.com`)).toBeNull();
  });

  it('marks email verified and updates the password hash', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const user = await userRepository.create({ email, passwordHash: 'hash', role: 'CUSTOMER' });
    createdUserIds.push(user.id);

    await userRepository.markEmailVerified(user.id);
    await userRepository.updatePasswordHash(user.id, 'new-hash');

    const updated = await userRepository.findById(user.id);
    expect(updated?.emailVerifiedAt).not.toBeNull();
    expect(updated?.passwordHash).toBe('new-hash');
  });

  it('creates, finds, revokes, and bulk-revokes refresh tokens', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const user = await userRepository.create({ email, passwordHash: 'hash', role: 'CUSTOMER' });
    createdUserIds.push(user.id);

    const record = await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: `hash-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const found = await refreshTokenRepository.findByTokenHash(record.tokenHash);
    expect(found?.id).toBe(record.id);
    expect(found?.revokedAt).toBeNull();

    await refreshTokenRepository.revoke(record.id);
    const revoked = await refreshTokenRepository.findByTokenHash(record.tokenHash);
    expect(revoked?.revokedAt).not.toBeNull();

    const second = await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: `hash-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await refreshTokenRepository.revokeAllForUser(user.id);

    const afterBulkRevoke = await refreshTokenRepository.findByTokenHash(second.tokenHash);
    expect(afterBulkRevoke?.revokedAt).not.toBeNull();
  });
});
