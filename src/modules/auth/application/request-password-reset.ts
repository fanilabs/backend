import type { Mailer, TokenService, UserRepository } from '../domain/index.js';

export interface RequestPasswordResetDeps {
  userRepository: UserRepository;
  tokenService: TokenService;
  mailer: Mailer;
}

export interface RequestPasswordResetInput {
  email: string;
}

/**
 * Always resolves successfully, whether or not the email is registered —
 * responding differently would let a caller enumerate registered accounts.
 * The only observable effect of a valid email is that a reset email is sent.
 */
export function createRequestPasswordResetUseCase(deps: RequestPasswordResetDeps) {
  return async function requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const user = await deps.userRepository.findByEmail(email);
    if (!user) {
      return;
    }

    const token = deps.tokenService.issuePasswordResetToken(user);
    await deps.mailer.sendPasswordResetEmail(user.email, token);
  };
}
