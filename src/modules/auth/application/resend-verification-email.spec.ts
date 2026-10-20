import { describe, expect, it } from 'vitest';
import { createResendVerificationEmailUseCase } from './resend-verification-email.js';
import {
  buildUser,
  createFakeMailer,
  createFakeTokenService,
  createInMemoryUserRepository,
} from './__fixtures__/fakes.js';

describe('resendVerificationEmail (#427)', () => {
  it('sends a fresh verification email for an unverified user', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const mailer = createFakeMailer();
    const user = buildUser({ email: 'unverified@example.com', emailVerifiedAt: null });
    userRepository.seed(user);

    const resend = createResendVerificationEmailUseCase({ userRepository, tokenService, mailer });
    await resend({ email: 'Unverified@Example.com' });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ kind: 'verification', to: 'unverified@example.com' });
  });

  it('is a silent no-op for already-verified or unknown emails', async () => {
    const userRepository = createInMemoryUserRepository();
    const tokenService = createFakeTokenService();
    const mailer = createFakeMailer();
    userRepository.seed(
      buildUser({ email: 'verified@example.com', emailVerifiedAt: new Date() }),
    );

    const resend = createResendVerificationEmailUseCase({ userRepository, tokenService, mailer });
    await resend({ email: 'verified@example.com' });
    await resend({ email: 'missing@example.com' });

    expect(mailer.sent).toHaveLength(0);
  });
});
