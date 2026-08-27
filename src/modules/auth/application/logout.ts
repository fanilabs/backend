import type { RefreshTokenRepository, TokenService } from '../domain/index.js';

export interface LogoutDeps {
  refreshTokenRepository: RefreshTokenRepository;
  tokenService: TokenService;
}

export interface LogoutInput {
  refreshToken: string;
}

/**
 * Best-effort revocation: an already-invalid or unknown token still resolves
 * successfully (there is nothing meaningful to tell the caller apart from
 * "already logged out"), it just revokes nothing.
 */
export function createLogoutUseCase(deps: LogoutDeps) {
  return async function logout(input: LogoutInput): Promise<void> {
    const tokenHash = deps.tokenService.hashToken(input.refreshToken);
    const record = await deps.refreshTokenRepository.findByTokenHash(tokenHash);
    if (record && record.revokedAt === null) {
      await deps.refreshTokenRepository.revoke(record.id);
    }
  };
}
