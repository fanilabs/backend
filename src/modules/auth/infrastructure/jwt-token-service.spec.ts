import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createJwtTokenService } from './jwt-token-service.js';
import { verifyAccessToken } from '../../../shared/jwt/index.js';
import type { User } from '../domain/index.js';

function testUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    email: 'user@example.com',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    role: 'CUSTOMER',
    emailVerifiedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('createJwtTokenService', () => {
  it('issues an access token that the shared verifier accepts with matching claims', () => {
    const tokenService = createJwtTokenService();
    const user = testUser({ role: 'ADMIN' });

    const token = tokenService.issueAccessToken(user);
    const claims = verifyAccessToken(token);

    expect(claims.sub).toBe(user.id);
    expect(claims.role).toBe('ADMIN');
  });

  it('issues a refresh token whose hash matches hashToken(token) and can be verified back to the user', () => {
    const tokenService = createJwtTokenService();
    const user = testUser();

    const issued = tokenService.issueRefreshToken(user);
    expect(issued.tokenHash).toBe(tokenService.hashToken(issued.token));
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const verified = tokenService.verifyRefreshToken(issued.token);
    expect(verified.userId).toBe(user.id);
    expect(verified.tokenHash).toBe(issued.tokenHash);
  });

  it('rejects a garbage refresh token', () => {
    const tokenService = createJwtTokenService();
    expect(() => tokenService.verifyRefreshToken('not-a-jwt')).toThrow();
  });

  it('round-trips an email verification token', () => {
    const tokenService = createJwtTokenService();
    const user = testUser();

    const token = tokenService.issueEmailVerificationToken(user);
    const result = tokenService.verifyEmailVerificationToken(token);

    expect(result.userId).toBe(user.id);
  });

  it('rejects a password-reset token presented as an email-verification token (purpose confusion)', () => {
    const tokenService = createJwtTokenService();
    const user = testUser();

    const resetToken = tokenService.issuePasswordResetToken(user);

    expect(() => tokenService.verifyEmailVerificationToken(resetToken)).toThrow();
  });

  it('verifies a password reset token against the matching current password hash', () => {
    const tokenService = createJwtTokenService();
    const user = testUser({ passwordHash: 'hash-v1' });

    const token = tokenService.issuePasswordResetToken(user);
    const result = tokenService.verifyPasswordResetToken(token, 'hash-v1');

    expect(result.userId).toBe(user.id);
  });

  it('rejects a password reset token once the password hash has changed', () => {
    const tokenService = createJwtTokenService();
    const user = testUser({ passwordHash: 'hash-v1' });

    const token = tokenService.issuePasswordResetToken(user);

    expect(() => tokenService.verifyPasswordResetToken(token, 'hash-v2')).toThrow();
  });

  it('peeks the subject of a password reset token without validating it', () => {
    const tokenService = createJwtTokenService();
    const user = testUser();

    const token = tokenService.issuePasswordResetToken(user);

    expect(tokenService.peekPasswordResetSubject(token)).toBe(user.id);
    expect(tokenService.peekPasswordResetSubject('garbage')).toBeNull();
  });

  it('rejects an email-verification token when presented to the access token verifier (purpose confusion protection)', () => {
    const tokenService = createJwtTokenService();
    const user = testUser();

    const emailVerificationToken = tokenService.issueEmailVerificationToken(user);

    expect(() => verifyAccessToken(emailVerificationToken)).toThrow();
  });

  it('rejects a password-reset token when presented to the access token verifier (purpose confusion protection)', () => {
    const tokenService = createJwtTokenService();
    const user = testUser();

    const resetToken = tokenService.issuePasswordResetToken(user);

    expect(() => verifyAccessToken(resetToken)).toThrow();
  });
});
