import { describe, expect, it } from 'vitest';
import { createLoginUseCase } from './login.js';
import { InvalidCredentialsError } from '../domain/index.js';
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
  const login = createLoginUseCase({
    userRepository,
    passwordHasher,
    tokenService,
    refreshTokenRepository,
  });
  return { userRepository, refreshTokenRepository, login };
}

describe('login', () => {
  it('issues an access + refresh token pair for correct credentials', async () => {
    const { userRepository, login } = setup();
    userRepository.seed(buildUser({ email: 'user@example.com', passwordHash: 'hashed:secret' }));

    const result = await login({ email: 'user@example.com', password: 'secret' });

    expect(result.accessToken).toContain('access.');
    expect(result.refreshToken).toContain('refresh.');
    expect(result.user.email).toBe('user@example.com');
  });

  it('persists the refresh token so it can later be looked up', async () => {
    const { userRepository, refreshTokenRepository, login } = setup();
    userRepository.seed(buildUser({ email: 'user@example.com', passwordHash: 'hashed:secret' }));

    const result = await login({ email: 'user@example.com', password: 'secret' });

    const stored = await refreshTokenRepository.findByTokenHash(`hash:${result.refreshToken}`);
    expect(stored).not.toBeNull();
    expect(stored?.revokedAt).toBeNull();
  });

  it('rejects an unknown email', async () => {
    const { login } = setup();

    await expect(login({ email: 'nobody@example.com', password: 'x' })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('rejects an incorrect password without revealing which part was wrong', async () => {
    const { userRepository, login } = setup();
    userRepository.seed(buildUser({ email: 'user@example.com', passwordHash: 'hashed:secret' }));

    await expect(login({ email: 'user@example.com', password: 'wrong' })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('performs password hashing work on unknown emails to prevent timing attacks', async () => {
    const { login } = setup();
    let compareCallCount = 0;
    const userRepository = createInMemoryUserRepository();
    const passwordHasher = {
      async hash(plain: string) {
        return `hashed:${plain}`;
      },
      async compare() {
        compareCallCount++;
        return false;
      },
    };
    const tokenService = createFakeTokenService();
    const refreshTokenRepository = createInMemoryRefreshTokenRepository();
    const loginWithSpy = createLoginUseCase({
      userRepository,
      passwordHasher,
      tokenService,
      refreshTokenRepository,
    });

    await expect(
      loginWithSpy({ email: 'nobody@example.com', password: 'anypassword' }),
    ).rejects.toThrow(InvalidCredentialsError);

    expect(compareCallCount).toBe(1);
  });
});
