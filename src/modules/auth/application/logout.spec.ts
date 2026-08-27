import { describe, expect, it } from 'vitest';
import { createLogoutUseCase } from './logout.js';
import {
  buildUser,
  createFakeTokenService,
  createInMemoryRefreshTokenRepository,
} from './__fixtures__/fakes.js';

describe('logout', () => {
  it('revokes the matching refresh token', async () => {
    const refreshTokenRepository = createInMemoryRefreshTokenRepository();
    const tokenService = createFakeTokenService();
    const user = buildUser();
    const issued = tokenService.issueRefreshToken(user);
    await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
    });

    const logout = createLogoutUseCase({ refreshTokenRepository, tokenService });
    await logout({ refreshToken: issued.token });

    const stored = await refreshTokenRepository.findByTokenHash(issued.tokenHash);
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('is a harmless no-op for an unknown token', async () => {
    const refreshTokenRepository = createInMemoryRefreshTokenRepository();
    const tokenService = createFakeTokenService();
    const logout = createLogoutUseCase({ refreshTokenRepository, tokenService });

    await expect(logout({ refreshToken: 'refresh:unknown:x' })).resolves.toBeUndefined();
  });
});
