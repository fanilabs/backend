import type { Clock, AuthUnitOfWork, TokenService } from '../domain/index.js';
import { InvalidRefreshTokenError, UserNotFoundError } from '../domain/index.js';

export interface RefreshSessionDeps {
  unitOfWork: AuthUnitOfWork;
  tokenService: TokenService;
  clock: Clock;
}

export interface RefreshSessionInput {
  refreshToken: string;
}

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Rotation-on-use: presenting a valid refresh token revokes it and issues a
 * fresh access + refresh pair, limiting how long a leaked refresh token
 * remains useful (docs/AUTHENTICATION.md).
 */
export function createRefreshSessionUseCase(deps: RefreshSessionDeps) {
  return async function refreshSession(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    let verified;
    try {
      verified = deps.tokenService.verifyRefreshToken(input.refreshToken);
    } catch {
      throw new InvalidRefreshTokenError();
    }

    // Invalid reuse must return from the transaction normally so revocation commits.
    const result = await deps.unitOfWork.run(
      verified.userId,
      async ({ userRepository, refreshTokenRepository }) => {
        const record = await refreshTokenRepository.findByTokenHash(verified.tokenHash);
        if (!record || record.userId !== verified.userId || !record.familyId) return null;
        if (record.revokedAt !== null) {
          await refreshTokenRepository.revokeFamily(record.familyId);
          return null;
        }
        if (
          record.expiresAt.getTime() <= deps.clock.now().getTime() ||
          !(await refreshTokenRepository.isFamilyActive(record.familyId))
        )
          return null;
        const user = await userRepository.findById(verified.userId);
        if (!user) throw new UserNotFoundError();
        await refreshTokenRepository.revoke(record.id);
        const accessToken = deps.tokenService.issueAccessToken(user);
        const issued = deps.tokenService.issueRefreshToken(user);
        await refreshTokenRepository.create({
          userId: user.id,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          familyId: record.familyId,
        });
        return { accessToken, refreshToken: issued.token };
      },
    );
    if (!result) throw new InvalidRefreshTokenError();
    return result;
  };
}
