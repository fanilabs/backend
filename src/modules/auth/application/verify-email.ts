import type { TokenService, UserRepository } from '../domain/index.js';
import { InvalidVerificationTokenError, UserNotFoundError } from '../domain/index.js';

export interface VerifyEmailDeps {
  userRepository: UserRepository;
  tokenService: TokenService;
}

export interface VerifyEmailInput {
  token: string;
}

export function createVerifyEmailUseCase(deps: VerifyEmailDeps) {
  return async function verifyEmail(input: VerifyEmailInput): Promise<void> {
    let claims;
    try {
      claims = deps.tokenService.verifyEmailVerificationToken(input.token);
    } catch {
      throw new InvalidVerificationTokenError();
    }

    const user = await deps.userRepository.findById(claims.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    if (user.emailVerifiedAt !== null) {
      return; // already verified — idempotent success, not an error
    }

    await deps.userRepository.markEmailVerified(user.id);
  };
}
