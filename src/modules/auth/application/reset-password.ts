import type { PasswordHasher, AuthUnitOfWork, TokenService } from '../domain/index.js';
import { InvalidPasswordResetTokenError } from '../domain/index.js';

export interface ResetPasswordDeps {
  unitOfWork: AuthUnitOfWork;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/** Password, refresh families and access-token version commit together.
 * Authentication reads the authoritative DB version on every request; Redis is
 * not an authorization source, so failed eviction or stale refill cannot extend access.
 */
export function createResetPasswordUseCase(deps: ResetPasswordDeps) {
  return async function resetPassword(input: ResetPasswordInput): Promise<void> {
    const claimedUserId = deps.tokenService.peekPasswordResetSubject(input.token);
    if (!claimedUserId) {
      throw new InvalidPasswordResetTokenError();
    }

    await deps.unitOfWork.run(claimedUserId, async ({ userRepository, refreshTokenRepository }) => {
      const user = await userRepository.findById(claimedUserId);
      if (!user) throw new InvalidPasswordResetTokenError();
      try {
        deps.tokenService.verifyPasswordResetToken(input.token, user.passwordHash);
      } catch {
        throw new InvalidPasswordResetTokenError();
      }
      const newHash = await deps.passwordHasher.hash(input.newPassword);
      await userRepository.updatePasswordHash(user.id, newHash);
      await refreshTokenRepository.revokeAllForUser(user.id);
      await userRepository.incrementTokenVersion(user.id);
    });
  };
}
