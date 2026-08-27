import type {
  Clock,
  RefreshTokenRepository,
  TokenService,
  UserRepository,
} from '../domain/index.js';
import { InvalidRefreshTokenError, UserNotFoundError } from '../domain/index.js';

export interface RefreshSessionDeps {
  refreshTokenRepository: RefreshTokenRepository;
  userRepository: UserRepository;
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

    const record = await deps.refreshTokenRepository.findByTokenHash(verified.tokenHash);
    if (
      !record ||
      record.revokedAt !== null ||
      record.expiresAt.getTime() < deps.clock.now().getTime()
    ) {
      throw new InvalidRefreshTokenError();
    }

    const user = await deps.userRepository.findById(verified.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    await deps.refreshTokenRepository.revoke(record.id);

    const accessToken = deps.tokenService.issueAccessToken(user);
    const issued = deps.tokenService.issueRefreshToken(user);
    await deps.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
    });

    return { accessToken, refreshToken: issued.token };
  };
}
