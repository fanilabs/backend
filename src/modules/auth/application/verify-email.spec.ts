import { describe, expect, it } from 'vitest';
import { createVerifyEmailUseCase } from './verify-email.js';
import { InvalidVerificationTokenError, UserNotFoundError } from '../domain/index.js';
import {
  buildUser,
  createFakeTokenService,
  createInMemoryUserRepository,
} from './__fixtures__/fakes.js';

describe('verifyEmail', () => {
  it('marks the user as verified', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const user = buildUser();
    userRepository.seed(user);
    const token = tokenService.issueEmailVerificationToken(user);

    const verifyEmail = createVerifyEmailUseCase({ userRepository, tokenService });
    await verifyEmail({ token });

    const stored = await userRepository.findById(user.id);
    expect(stored?.emailVerifiedAt).not.toBeNull();
  });

  it('is idempotent for an already-verified user', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const verifiedAt = new Date('2026-01-01T00:00:00Z');
    const user = buildUser({ emailVerifiedAt: verifiedAt });
    userRepository.seed(user);
    const token = tokenService.issueEmailVerificationToken(user);

    const verifyEmail = createVerifyEmailUseCase({ userRepository, tokenService });
    await expect(verifyEmail({ token })).resolves.toBeUndefined();

    const stored = await userRepository.findById(user.id);
    expect(stored?.emailVerifiedAt).toEqual(verifiedAt);
  });

  it('rejects a malformed token', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const verifyEmail = createVerifyEmailUseCase({ userRepository, tokenService });

    await expect(verifyEmail({ token: 'garbage' })).rejects.toThrow(InvalidVerificationTokenError);
  });

  it('rejects a well-formed token for a user that no longer exists', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const verifyEmail = createVerifyEmailUseCase({ userRepository, tokenService });
    // A validly-signed token for a user who was since deleted — the
    // repository is never seeded with this user.
    const token = tokenService.issueEmailVerificationToken(buildUser());

    await expect(verifyEmail({ token })).rejects.toThrow(UserNotFoundError);
  });
});
