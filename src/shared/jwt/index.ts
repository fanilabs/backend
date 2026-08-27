import jwt from 'jsonwebtoken';
import { getConfig } from '../config/index.js';
import type { UserRole } from '@prisma/client';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
}

export interface RefreshTokenClaims {
  sub: string;
  /** Random per-token id, distinct from the user id, so a specific refresh
   * token can be identified/revoked without invalidating every session. */
  jti: string;
}

/**
 * Single source of truth for JWT signing/verification — used by the `auth`
 * module (issuing tokens on login/refresh) and by the shared HTTP auth
 * guard (verifying them on every protected route), so the claim shape and
 * secret handling never drifts between the two call sites.
 */
export function signAccessToken(claims: AccessTokenClaims): string {
  const config = getConfig();
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const config = getConfig();
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
  return decoded as unknown as AccessTokenClaims;
}

export function signRefreshToken(claims: RefreshTokenClaims): string {
  const config = getConfig();
  return jwt.sign(claims, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_TTL,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const config = getConfig();
  const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET);
  return decoded as unknown as RefreshTokenClaims;
}
