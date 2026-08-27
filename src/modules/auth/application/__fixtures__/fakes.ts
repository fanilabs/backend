import { randomUUID } from 'node:crypto';
import type {
  Clock,
  IssuedRefreshToken,
  Mailer,
  PasswordHasher,
  RefreshTokenRecord,
  RefreshTokenRepository,
  TokenService,
  User,
  UserRepository,
  UserRole,
  VerifiedRefreshToken,
} from '../../domain/index.js';

/**
 * In-memory / fake implementations of the `auth` domain ports, used only by
 * application-layer unit tests (never imported by production code — see
 * tsconfig.build.json's exclude list). This is standard hexagonal-
 * architecture test doubling of a *port*, distinct from
 * PHASE_2/ROADMAP's guidance against mocking the *infrastructure layer's
 * own* tests (e.g. the real Prisma repository against a real database).
 */

export function createInMemoryUserRepository(): UserRepository & { seed(user: User): void } {
  const users = new Map<string, User>();

  return {
    seed(user) {
      users.set(user.id, user);
    },
    async findByEmail(email) {
      for (const user of users.values()) {
        if (user.email === email) return user;
      }
      return null;
    },
    async findById(id) {
      return users.get(id) ?? null;
    },
    async create(input) {
      const user: User = {
        id: randomUUID(),
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
        emailVerifiedAt: null,
        createdAt: new Date(),
      };
      users.set(user.id, user);
      return user;
    },
    async markEmailVerified(id) {
      const user = users.get(id);
      if (user) user.emailVerifiedAt = new Date();
    },
    async updatePasswordHash(id, passwordHash) {
      const user = users.get(id);
      if (user) user.passwordHash = passwordHash;
    },
  };
}

export function createInMemoryRefreshTokenRepository(): RefreshTokenRepository {
  const records = new Map<string, RefreshTokenRecord>();

  return {
    async create(input) {
      const record: RefreshTokenRecord = {
        id: randomUUID(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        createdAt: new Date(),
      };
      records.set(record.id, record);
      return record;
    },
    async findByTokenHash(tokenHash) {
      for (const record of records.values()) {
        if (record.tokenHash === tokenHash) return record;
      }
      return null;
    },
    async revoke(id) {
      const record = records.get(id);
      if (record) record.revokedAt = new Date();
    },
    async revokeAllForUser(userId) {
      for (const record of records.values()) {
        if (record.userId === userId && record.revokedAt === null) {
          record.revokedAt = new Date();
        }
      }
    },
  };
}

export function createFakePasswordHasher(): PasswordHasher {
  return {
    async hash(plain) {
      return `hashed:${plain}`;
    },
    async compare(plain, hash) {
      return hash === `hashed:${plain}`;
    },
  };
}

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fake tokens are `${kind}.${base64(JSON.stringify(payload))}` — structured
 * encoding rather than naive colon-joining, so that payload values which
 * themselves contain the delimiter (e.g. the fake password hasher's
 * `hashed:${plain}` format) can never corrupt the encoding the way a plain
 * `token.split(':')` scheme would.
 */
function encodeFakeToken(kind: string, payload: Record<string, unknown>): string {
  return `${kind}.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function decodeFakeToken(token: string): { kind: string; payload: Record<string, unknown> } | null {
  const separatorIndex = token.indexOf('.');
  if (separatorIndex === -1) return null;
  const kind = token.slice(0, separatorIndex);
  try {
    const payload = JSON.parse(
      Buffer.from(token.slice(separatorIndex + 1), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    return { kind, payload };
  } catch {
    return null;
  }
}

export function createFakeTokenService(): TokenService {
  return {
    issueAccessToken(user) {
      return encodeFakeToken('access', { sub: user.id, role: user.role });
    },
    issueRefreshToken(user): IssuedRefreshToken {
      const token = encodeFakeToken('refresh', { sub: user.id, jti: randomUUID() });
      return {
        token,
        tokenHash: `hash:${token}`,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      };
    },
    verifyRefreshToken(token): VerifiedRefreshToken {
      const decoded = decodeFakeToken(token);
      if (!decoded || decoded.kind !== 'refresh' || typeof decoded.payload.sub !== 'string') {
        throw new Error('invalid refresh token');
      }
      return { userId: decoded.payload.sub, tokenHash: `hash:${token}` };
    },
    hashToken(token) {
      return `hash:${token}`;
    },
    issueEmailVerificationToken(user) {
      return encodeFakeToken('verify', { sub: user.id });
    },
    verifyEmailVerificationToken(token) {
      const decoded = decodeFakeToken(token);
      if (!decoded || decoded.kind !== 'verify' || typeof decoded.payload.sub !== 'string') {
        throw new Error('invalid verification token');
      }
      return { userId: decoded.payload.sub };
    },
    issuePasswordResetToken(user) {
      return encodeFakeToken('reset', { sub: user.id, pwFingerprint: user.passwordHash });
    },
    verifyPasswordResetToken(token, currentPasswordHash) {
      const decoded = decodeFakeToken(token);
      if (!decoded || decoded.kind !== 'reset' || typeof decoded.payload.sub !== 'string') {
        throw new Error('invalid password reset token');
      }
      if (decoded.payload.pwFingerprint !== currentPasswordHash) {
        throw new Error('password reset token is stale');
      }
      return { userId: decoded.payload.sub };
    },
    peekPasswordResetSubject(token) {
      const decoded = decodeFakeToken(token);
      if (!decoded || decoded.kind !== 'reset' || typeof decoded.payload.sub !== 'string') {
        return null;
      }
      return decoded.payload.sub;
    },
  };
}

export function createFakeMailer(): Mailer & {
  sent: Array<{ kind: 'verification' | 'password-reset'; to: string; token: string }>;
} {
  const sent: Array<{ kind: 'verification' | 'password-reset'; to: string; token: string }> = [];
  return {
    sent,
    async sendVerificationEmail(to, token) {
      sent.push({ kind: 'verification', to, token });
    },
    async sendPasswordResetEmail(to, token) {
      sent.push({ kind: 'password-reset', to, token });
    },
  };
}

export function createFakeClock(initial: Date = new Date()): Clock & { set(date: Date): void } {
  let current = initial;
  return {
    now() {
      return current;
    },
    set(date) {
      current = date;
    },
  };
}

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    email: 'user@example.com',
    passwordHash: 'hashed:password123',
    role: 'CUSTOMER' as UserRole,
    emailVerifiedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}
