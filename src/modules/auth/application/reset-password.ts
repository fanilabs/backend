import type {
  PasswordHasher,
  RefreshTokenRepository,
  TokenService,
  UserRepository,
} from '../domain/index.js';
import { InvalidPasswordResetTokenError } from '../domain/index.js';

export interface ResetPasswordDeps {
  userRepository: UserRepository;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  refreshTokenRepository: RefreshTokenRepository;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/**
 * Creates the reset-password use case.
 *
 * The returned function completes a password reset for a user who presents a
 * valid reset token: it resolves the token's subject, verifies the token
 * against the user's current password hash, stores the new password hash, and
 * revokes all of the user's existing refresh tokens.
 *
 * @param deps - Collaborators required by the use case:
 *   - `userRepository`: looks up the user and persists the new password hash.
 *   - `passwordHasher`: hashes the new password before it is stored.
 *   - `tokenService`: peeks the token subject and verifies the reset token.
 *   - `refreshTokenRepository`: revokes every refresh token for the user.
 * @returns An async function that accepts a {@link ResetPasswordInput}
 *   (`token` and `newPassword`) and resolves once the password has been
 *   updated and all sessions invalidated. It rejects with
 *   {@link InvalidPasswordResetTokenError} when the token is missing, unknown,
 *   or no longer matches the user's current password hash.
 */
export function createResetPasswordUseCase(deps: ResetPasswordDeps) {
  return async function resetPassword(input: ResetPasswordInput): Promise<void> {
    const claimedUserId = deps.tokenService.peekPasswordResetSubject(input.token);
    if (!claimedUserId) {
      throw new InvalidPasswordResetTokenError();
    }

    const user = await deps.userRepository.findById(claimedUserId);
    if (!user) {
      throw new InvalidPasswordResetTokenError();
    }

    try {
      // The token embeds a fingerprint of the password hash that was
      // current when it was issued — verifying against the *current* hash
      // means a token becomes invalid the instant the password changes,
      // without needing a revocation table (docs/AUTHENTICATION.md).
      deps.tokenService.verifyPasswordResetToken(input.token, user.passwordHash);
    } catch {
      throw new InvalidPasswordResetTokenError();
    }

    const newHash = await deps.passwordHasher.hash(input.newPassword);
    await deps.userRepository.updatePasswordHash(user.id, newHash);

    // A password reset is a strong signal to invalidate every existing
    // session, not just issue the caller a new one.
    await deps.refreshTokenRepository.revokeAllForUser(user.id);
  };
}
