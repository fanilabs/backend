import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { getConfig } from '../config/index.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './index.js';

/**
 * Direct tests for shared/jwt — the single source of truth every protected
 * route trusts (via the shared HTTP auth guard) and that `auth` trusts for
 * token issuance. Its own boundary conditions (wrong secret, expired,
 * tampered, access/refresh confusion) were previously only exercised as a
 * side effect of the `auth` module's higher-level flow tests.
 */
describe('shared/jwt', () => {
  const config = getConfig();

  describe('access tokens', () => {
    it('round-trips the signed claims', () => {
      const claims = { sub: randomUUID(), role: 'ADMIN' as const };

      const decoded = verifyAccessToken(signAccessToken(claims));

      expect(decoded.sub).toBe(claims.sub);
      expect(decoded.role).toBe('ADMIN');
    });

    it('rejects a token signed with the wrong secret', () => {
      const forged = jwt.sign({ sub: randomUUID(), role: 'CUSTOMER' }, 'not-the-access-secret');

      expect(() => verifyAccessToken(forged)).toThrow();
    });

    it('rejects an expired token', () => {
      const expired = jwt.sign({ sub: randomUUID(), role: 'CUSTOMER' }, config.JWT_ACCESS_SECRET, {
        expiresIn: -10,
      });

      expect(() => verifyAccessToken(expired)).toThrow(jwt.TokenExpiredError);
    });

    it('rejects a token whose payload has been tampered with', () => {
      const token = signAccessToken({ sub: randomUUID(), role: 'CUSTOMER' });
      const [header, payload, signature] = token.split('.') as [string, string, string];
      const forgedPayload = Buffer.from(
        JSON.stringify({
          ...(JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>),
          role: 'ADMIN',
        }),
      ).toString('base64url');

      expect(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).toThrow();
    });

    it('rejects a refresh token presented where an access token is expected', () => {
      const refreshToken = signRefreshToken({ sub: randomUUID(), jti: randomUUID() });

      expect(() => verifyAccessToken(refreshToken)).toThrow();
    });
  });

  describe('refresh tokens', () => {
    it('round-trips the signed claims', () => {
      const claims = { sub: randomUUID(), jti: randomUUID() };

      const decoded = verifyRefreshToken(signRefreshToken(claims));

      expect(decoded.sub).toBe(claims.sub);
      expect(decoded.jti).toBe(claims.jti);
    });

    it('rejects a token signed with the wrong secret', () => {
      const forged = jwt.sign({ sub: randomUUID(), jti: randomUUID() }, 'not-the-refresh-secret');

      expect(() => verifyRefreshToken(forged)).toThrow();
    });

    it('rejects an expired token', () => {
      const expired = jwt.sign(
        { sub: randomUUID(), jti: randomUUID() },
        config.JWT_REFRESH_SECRET,
        { expiresIn: -10 },
      );

      expect(() => verifyRefreshToken(expired)).toThrow(jwt.TokenExpiredError);
    });

    it('rejects an access token presented where a refresh token is expected', () => {
      const accessToken = signAccessToken({ sub: randomUUID(), role: 'CUSTOMER' });

      expect(() => verifyRefreshToken(accessToken)).toThrow();
    });
  });
});
