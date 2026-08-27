import { describe, expect, it } from 'vitest';
import { createResetPasswordUseCase } from './reset-password.js';
import { InvalidPasswordResetTokenError } from '../domain/index.js';
import {
  buildUser,
  createFakePasswordHasher,
  createFakeTokenService,
  createInMemoryRefreshTokenRepository,
  createInMemoryUserRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const userRepository = createInMemoryUserRepository();
  const passwordHasher = createFakePasswordHasher();
  const tokenService = createFakeTokenService();
  const refreshTokenRepository = createInMemoryRefreshTokenRepository();
  const resetPassword = createResetPasswordUseCase({
    userRepository,
    passwordHasher,
    tokenService,
    refreshTokenRepository,
  });
  return { userRepository, tokenService, refreshTokenRepository, resetPassword };
}

describe('resetPassword', () => {
  it('updates the password hash', async () => {
    const { userRepository, tokenService, resetPassword } = setup();
    const user = buildUser({ passwordHash: 'hashed:old' });
    userRepository.seed(user);
    const token = tokenService.issuePasswordResetToken(user);

    await resetPassword({ token, newPassword: 'newpassword' });

    const stored = await userRepository.findById(user.id);
    expect(stored?.passwordHash).toBe('hashed:newpassword');
  });

  it('revokes all existing sessions', async () => {
    const { userRepository, tokenService, refreshTokenRepository, resetPassword } = setup();
    const user = buildUser({ passwordHash: 'hashed:old' });
    userRepository.seed(user);
    const issued = tokenService.issueRefreshToken(user);
    await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
    });
    const token = tokenService.issuePasswordResetToken(user);

    await resetPassword({ token, newPassword: 'newpassword' });

    const stored = await refreshTokenRepository.findByTokenHash(issued.tokenHash);
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('rejects a token issued against a password that has since changed', async () => {
    const { userRepository, tokenService, resetPassword } = setup();
    const user = buildUser({ passwordHash: 'hashed:old' });
    userRepository.seed(user);
    const staleToken = tokenService.issuePasswordResetToken(user);

    // password changes out from under the token (e.g. user reset it via a
    // different, newer email link) — the stale token must stop working
    await userRepository.updatePasswordHash(user.id, 'hashed:changed-elsewhere');

    await expect(resetPassword({ token: staleToken, newPassword: 'whatever' })).rejects.toThrow(
      InvalidPasswordResetTokenError,
    );
  });

  it('rejects a malformed token', async () => {
    const { resetPassword } = setup();

    await expect(resetPassword({ token: 'garbage', newPassword: 'x' })).rejects.toThrow(
      InvalidPasswordResetTokenError,
    );
  });
});
