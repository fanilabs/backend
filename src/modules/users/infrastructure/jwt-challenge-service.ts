import jwt from 'jsonwebtoken';
import { getConfig } from '../../../shared/config/index.js';
import type { ChallengeService, VerifiedChallenge } from '../domain/index.js';

const CHALLENGE_TTL = '5m';

interface WalletLinkClaims {
  sub?: string;
  address?: string;
  purpose?: string;
}

/**
 * The challenge itself is a short-TTL JWT — the same "no extra database
 * table" pattern as auth's email-verification/password-reset tokens
 * (docs/AUTHENTICATION.md). The `purpose` claim keeps it from being
 * confusable with an access token or any other token type signed with the
 * same secret.
 */
export function createJwtChallengeService(): ChallengeService {
  const config = getConfig();

  return {
    issueWalletLinkChallenge(userId, address) {
      return jwt.sign({ sub: userId, address, purpose: 'wallet-link' }, config.JWT_ACCESS_SECRET, {
        expiresIn: CHALLENGE_TTL,
      } as jwt.SignOptions);
    },
    verifyWalletLinkChallenge(challenge): VerifiedChallenge {
      const decoded = jwt.verify(challenge, config.JWT_ACCESS_SECRET) as WalletLinkClaims;
      if (decoded.purpose !== 'wallet-link' || !decoded.sub || !decoded.address) {
        throw new Error('Token is not a valid wallet-link challenge');
      }
      return { userId: decoded.sub, address: decoded.address };
    },
  };
}
