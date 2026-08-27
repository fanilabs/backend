import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createJwtChallengeService } from './jwt-challenge-service.js';

describe('createJwtChallengeService', () => {
  it('round-trips a challenge back to the same user and address', () => {
    const challengeService = createJwtChallengeService();
    const userId = randomUUID();
    const address = 'GABCEXAMPLE';

    const challenge = challengeService.issueWalletLinkChallenge(userId, address);
    const verified = challengeService.verifyWalletLinkChallenge(challenge);

    expect(verified).toEqual({ userId, address });
  });

  it('rejects a garbage challenge', () => {
    const challengeService = createJwtChallengeService();
    expect(() => challengeService.verifyWalletLinkChallenge('not-a-jwt')).toThrow();
  });

  it('rejects a token signed with the same secret but a different purpose (e.g. an access token)', () => {
    const challengeService = createJwtChallengeService();
    const foreignToken = jwt.sign(
      { sub: 'x', role: 'CUSTOMER' },
      process.env.JWT_ACCESS_SECRET as string,
    );

    expect(() => challengeService.verifyWalletLinkChallenge(foreignToken)).toThrow();
  });
});
