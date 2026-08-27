import { describe, expect, it } from 'vitest';
import { createRegisterUserUseCase } from './register-user.js';
import { EmailAlreadyRegisteredError } from '../domain/index.js';
import {
  createFakeMailer,
  createFakePasswordHasher,
  createFakeTokenService,
  createInMemoryUserRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const userRepository = createInMemoryUserRepository();
  const passwordHasher = createFakePasswordHasher();
  const tokenService = createFakeTokenService();
  const mailer = createFakeMailer();
  const registerUser = createRegisterUserUseCase({
    userRepository,
    passwordHasher,
    tokenService,
    mailer,
  });
  return { userRepository, passwordHasher, tokenService, mailer, registerUser };
}

describe('registerUser', () => {
  it('creates a user with a hashed password and CUSTOMER as the default role', async () => {
    const { registerUser, userRepository } = setup();

    const result = await registerUser({ email: 'New.User@Example.com', password: 'password123' });

    const stored = await userRepository.findById(result.userId);
    expect(stored).not.toBeNull();
    expect(stored?.email).toBe('new.user@example.com');
    expect(stored?.passwordHash).toBe('hashed:password123');
    expect(stored?.role).toBe('CUSTOMER');
    expect(stored?.emailVerifiedAt).toBeNull();
  });

  it('respects an explicit role', async () => {
    const { registerUser, userRepository } = setup();

    const result = await registerUser({
      email: 'driver@example.com',
      password: 'pw',
      role: 'COURIER',
    });

    const stored = await userRepository.findById(result.userId);
    expect(stored?.role).toBe('COURIER');
  });

  it('sends a verification email', async () => {
    const { registerUser, mailer } = setup();

    await registerUser({ email: 'user@example.com', password: 'pw' });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ kind: 'verification', to: 'user@example.com' });
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    const { registerUser } = setup();

    await registerUser({ email: 'dup@example.com', password: 'pw' });

    await expect(registerUser({ email: 'DUP@Example.com', password: 'pw2' })).rejects.toThrow(
      EmailAlreadyRegisteredError,
    );
  });
});
