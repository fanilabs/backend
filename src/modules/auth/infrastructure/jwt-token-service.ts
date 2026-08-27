import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '../../../shared/config/index.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken as verifySharedRefreshToken,
} from '../../../shared/jwt/index.js';
import type { IssuedRefreshToken, TokenService, VerifiedRefreshToken } from '../domain/index.js';

const EMAIL_VERIFICATION_TTL = '24h';
const PASSWORD_RESET_TTL = '1h';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface PurposeClaims {
  sub?: string;
  purpose?: string;
  pwFingerprint?: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * A short digest of the current password hash, embedded in password-reset
 * tokens — never the raw bcrypt hash itself (no reason to put that in an
 * emailed link even though bcrypt hashes are designed to be exposure-safe).
 * Matching it against the *current* user record's fingerprint on verify is
 * what makes a reset token self-invalidate the moment the password
 * actually changes, without a revocation table — see docs/AUTHENTICATION.md.
 */
function passwordFingerprint(passwordHash: string): string {
  return sha256Hex(passwordHash).slice(0, 16);
}

/**
 * Real TokenService implementation of the `auth` domain port
 * (src/modules/auth/domain/ports.ts), backed by `jsonwebtoken`. Session
 * tokens (access/refresh) reuse src/shared/jwt so their claim shape and
 * secret handling stay identical to what the shared HTTP auth guard
 * verifies; single-purpose tokens (email verification, password reset) are
 * signed here directly with an explicit `purpose` claim, checked strictly
 * on verify, so a token issued for one purpose can never be replayed as
 * another even though they share a signing secret.
 */
export function createJwtTokenService(): TokenService {
  const config = getConfig();

  return {
    issueAccessToken(user) {
      return signAccessToken({ sub: user.id, role: user.role });
    },

    issueRefreshToken(user): IssuedRefreshToken {
      const token = signRefreshToken({ sub: user.id, jti: randomUUID() });
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const expiresAt = decoded?.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + THIRTY_DAYS_MS);
      return { token, tokenHash: sha256Hex(token), expiresAt };
    },

    verifyRefreshToken(token): VerifiedRefreshToken {
      const claims = verifySharedRefreshToken(token);
      return { userId: claims.sub, tokenHash: sha256Hex(token) };
    },

    hashToken: sha256Hex,

    issueEmailVerificationToken(user) {
      return jwt.sign({ sub: user.id, purpose: 'email-verification' }, config.JWT_ACCESS_SECRET, {
        expiresIn: EMAIL_VERIFICATION_TTL,
      } as jwt.SignOptions);
    },

    verifyEmailVerificationToken(token) {
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as PurposeClaims;
      if (decoded.purpose !== 'email-verification' || !decoded.sub) {
        throw new Error('Token is not a valid email verification token');
      }
      return { userId: decoded.sub };
    },

    issuePasswordResetToken(user) {
      return jwt.sign(
        {
          sub: user.id,
          purpose: 'password-reset',
          pwFingerprint: passwordFingerprint(user.passwordHash),
        },
        config.JWT_ACCESS_SECRET,
        { expiresIn: PASSWORD_RESET_TTL } as jwt.SignOptions,
      );
    },

    verifyPasswordResetToken(token, currentPasswordHash) {
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as PurposeClaims;
      if (decoded.purpose !== 'password-reset' || !decoded.sub) {
        throw new Error('Token is not a valid password reset token');
      }
      if (decoded.pwFingerprint !== passwordFingerprint(currentPasswordHash)) {
        throw new Error('Password reset token was issued against a since-changed password');
      }
      return { userId: decoded.sub };
    },

    peekPasswordResetSubject(token) {
      const decoded = jwt.decode(token) as PurposeClaims | null;
      if (!decoded || decoded.purpose !== 'password-reset' || !decoded.sub) {
        return null;
      }
      return decoded.sub;
    },
  };
}
