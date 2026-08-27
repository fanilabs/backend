import { describe, expect, it } from 'vitest';
import { createRefreshSessionUseCase } from './refresh-session.js';
import { InvalidRefreshTokenError } from '../domain/index.js';
import {
  buildUser,
  createFakeClock,
  createFakeTokenService,
  createInMemoryRefreshTokenRepository,
  createInMemoryUserRepository,
} from './__fixtures__/fakes.js';

async function setupWithSession() {
  const userRepository = createInMemoryUserRepository();
  const refreshTokenRepository = createInMemoryRefreshTokenRepository();
  const tokenService = createFakeTokenService();
  const clock = createFakeClock(new Date('2026-01-01T00:00:00Z'));

  const user = buildUser({ email: 'user@example.com' });
  userRepository.seed(user);

  const issued = tokenService.issueRefreshToken(user);
  await refreshTokenRepository.create({
    userId: user.id,
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
  });

  const refreshSession = createRefreshSessionUseCase({
    userRepository,
    refreshTokenRepository,
    tokenService,
    clock,
  });

  return { user, issued, refreshTokenRepository, refreshSession, clock };
}

describe('refreshSession', () => {
  it('issues a new token pair and revokes the presented one (rotation-on-use)', async () => {
    const { issued, refreshTokenRepository, refreshSession } = await setupWithSession();

    const result = await refreshSession({ refreshToken: issued.token });

    expect(result.refreshToken).not.toBe(issued.token);

    const oldRecord = await refreshTokenRepository.findByTokenHash(issued.tokenHash);
    expect(oldRecord?.revokedAt).not.toBeNull();
  });

  it('rejects a malformed token', async () => {
    const { refreshSession } = await setupWithSession();

    await expect(refreshSession({ refreshToken: 'not-a-real-token' })).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });

  it('rejects a token that has already been revoked (reuse after logout/rotation)', async () => {
    const { issued, refreshSession } = await setupWithSession();

    await refreshSession({ refreshToken: issued.token });

    await expect(refreshSession({ refreshToken: issued.token })).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });

  it('rejects a token whose stored record has expired', async () => {
    const { issued, refreshSession, clock } = await setupWithSession();

    clock.set(new Date(issued.expiresAt.getTime() + 1000));

    await expect(refreshSession({ refreshToken: issued.token })).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });
});
