import type { TokenService, UserRepository } from '../domain/index.js';
import { InvalidVerificationTokenError, UserNotFoundError } from '../domain/index.js';

export interface VerifyEmailDeps {
  userRepository: UserRepository;
  tokenService: TokenService;
}

export interface VerifyEmailInput {
  token: string;
}

/**
 * Creates the use case that verifies a user's email address.
 *
 * The returned function validates the supplied verification token, resolves the
 * associated user, and marks the user's email as verified. Verification is
 * idempotent: if the user's email is already verified, the call resolves without
 * error.
 *
 * @param deps - Dependencies required by the use case.
 * @param deps.userRepository - Repository used to look up the user and persist the verified state.
 * @param deps.tokenService - Service used to verify and decode the email verification token.
 * @returns An async function that accepts a {@link VerifyEmailInput} and resolves once the
 * email is verified. It throws {@link InvalidVerificationTokenError} when the token is invalid
 * or expired, and {@link UserNotFoundError} when no user matches the token's claims.
 */
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
