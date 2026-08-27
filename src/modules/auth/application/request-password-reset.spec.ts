import { describe, expect, it } from 'vitest';
import { createRequestPasswordResetUseCase } from './request-password-reset.js';
import {
  buildUser,
  createFakeMailer,
  createFakeTokenService,
  createInMemoryUserRepository,
} from './__fixtures__/fakes.js';

describe('requestPasswordReset', () => {
  it('sends a reset email for a registered address', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const mailer = createFakeMailer();
    userRepository.seed(buildUser({ email: 'user@example.com' }));

    const requestPasswordReset = createRequestPasswordResetUseCase({
      userRepository,
      tokenService,
      mailer,
    });
    await requestPasswordReset({ email: 'user@example.com' });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ kind: 'password-reset', to: 'user@example.com' });
  });

  it('resolves without sending anything for an unregistered address (no user enumeration)', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const mailer = createFakeMailer();

    const requestPasswordReset = createRequestPasswordResetUseCase({
      userRepository,
      tokenService,
      mailer,
    });
    await expect(requestPasswordReset({ email: 'nobody@example.com' })).resolves.toBeUndefined();

    expect(mailer.sent).toHaveLength(0);
  });
});
