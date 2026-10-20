import type { Mailer, TokenService, UserRepository } from '../domain/index.js';

export interface ResendVerificationEmailDeps {
  userRepository: UserRepository;
  tokenService: TokenService;
  mailer: Mailer;
}

export interface ResendVerificationEmailInput {
  email: string;
}

/**
 * Issues and sends a fresh email verification token when `email` belongs to an
 * existing, still-unverified user. Always resolves without error for unknown
 * or already-verified addresses to prevent account enumeration (#427).
 */
export function createResendVerificationEmailUseCase(deps: ResendVerificationEmailDeps) {
  return async function resendVerificationEmail(
    input: ResendVerificationEmailInput,
  ): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const user = await deps.userRepository.findByEmail(email);
    if (!user || user.emailVerifiedAt !== null) {
      return;
    }

    const token = deps.tokenService.issueEmailVerificationToken(user);
    await deps.mailer.sendVerificationEmail(user.email, token);
  };
}
