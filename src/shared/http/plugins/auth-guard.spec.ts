import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './auth-guard.js';
import { signAccessToken } from '../../jwt/index.js';
import { getPrismaClient } from '../../database/index.js';
import { UnauthorizedError } from '../../errors/index.js';
import type * as AuthCacheModule from '../../cache/index.js';

/**
 * Unit coverage for `authenticate`'s DB-backed `tokenVersion` check
 * (security issue #12) — stubs the shared Prisma singleton's `user.findUnique`
 * directly (same instance `authenticate` itself calls, since
 * `getPrismaClient()` is memoized) rather than mocking the whole module, so
 * this exercises the real guard logic without a live database.
 *
 * The Redis-backed auth context cache (#369) is likewise replaced at the
 * same singleton boundary `authenticate` consumes it through — an
 * in-memory map behind the same two functions — so the guard's real
 * cache-interaction logic (miss → DB read → populate, hit → no DB read,
 * eviction → fresh read) runs without a live Redis.
 */
const cacheEntries = vi.hoisted(
  () =>
    new Map<
      string,
      { role: 'ADMIN' | 'CUSTOMER' | 'COURIER' | 'FLEET_MANAGER'; tokenVersion: number }
    >(),
);

vi.mock('../../cache/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthCacheModule>();
  return {
    ...actual,
    readAuthContext: (userId: string) => Promise.resolve(cacheEntries.get(userId) ?? null),
    writeAuthContext: (
      userId: string,
      context: { role: 'ADMIN' | 'CUSTOMER' | 'COURIER' | 'FLEET_MANAGER'; tokenVersion: number },
    ) => {
      cacheEntries.set(userId, context);
      return Promise.resolve();
    },
  };
});

/**
 * Unit coverage for `authenticate`'s DB-backed `tokenVersion` check
 * (security issue #12) — see the note above the cache mock.
 */
function fakeRequest(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as unknown as FastifyRequest;
}

const fakeReply = {} as FastifyReply;

beforeEach(() => {
  cacheEntries.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticate — tokenVersion check', () => {
  it('accepts a token whose tokenVersion matches the current DB value', async () => {
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValueOnce({
      role: 'ADMIN',
      tokenVersion: 2,
    } as never);
    const token = signAccessToken({ sub: 'user-1', role: 'ADMIN', tokenVersion: 2 });
    const request = fakeRequest(`Bearer ${token}`);

    await authenticate(request, fakeReply);

    expect(request.user).toEqual({ id: 'user-1', role: 'ADMIN' });
  });

  it('rejects a token with a stale tokenVersion — the core of security issue #12', async () => {
    // Simulates: token was issued while tokenVersion was 2, but an admin
    // changed this user's role since (bumping tokenVersion to 3).
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValueOnce({
      role: 'CUSTOMER',
      tokenVersion: 3,
    } as never);
    const token = signAccessToken({ sub: 'user-1', role: 'ADMIN', tokenVersion: 2 });
    const request = fakeRequest(`Bearer ${token}`);

    await expect(authenticate(request, fakeReply)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(request.user).toBeUndefined();
  });

  it("trusts the freshly-read DB role over the token's own (potentially stale) role claim", async () => {
    // Same tokenVersion (so the token isn't rejected outright), but the DB
    // role has since changed — defense in depth: role must never be taken
    // from the token when a fresh DB read is already available.
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValueOnce({
      role: 'CUSTOMER',
      tokenVersion: 5,
    } as never);
    const token = signAccessToken({ sub: 'user-1', role: 'ADMIN', tokenVersion: 5 });
    const request = fakeRequest(`Bearer ${token}`);

    await authenticate(request, fakeReply);

    expect(request.user).toEqual({ id: 'user-1', role: 'CUSTOMER' });
  });

  it('treats a token with no tokenVersion claim (issued before this migration) as version 0', async () => {
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValueOnce({
      role: 'CUSTOMER',
      tokenVersion: 0,
    } as never);
    const token = signAccessToken({ sub: 'user-1', role: 'CUSTOMER' });
    const request = fakeRequest(`Bearer ${token}`);

    await authenticate(request, fakeReply);

    expect(request.user).toEqual({ id: 'user-1', role: 'CUSTOMER' });
  });

  it('rejects a well-signed token for a user that no longer exists', async () => {
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValueOnce(null);
    const token = signAccessToken({ sub: 'deleted-user', role: 'ADMIN', tokenVersion: 0 });
    const request = fakeRequest(`Bearer ${token}`);

    await expect(authenticate(request, fakeReply)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('still rejects a missing Authorization header without touching the database', async () => {
    const spy = vi.spyOn(getPrismaClient().user, 'findUnique');
    const request = fakeRequest();

    await expect(authenticate(request, fakeReply)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('authenticate — auth context cache (#369)', () => {
  it('serves the second request from the cache — one database read for two requests', async () => {
    const spy = vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValue({
      role: 'COURIER',
      tokenVersion: 1,
    } as never);
    const token = signAccessToken({ sub: 'user-cache', role: 'COURIER', tokenVersion: 1 });

    await authenticate(fakeRequest(`Bearer ${token}`), fakeReply);
    const second = fakeRequest(`Bearer ${token}`);
    await authenticate(second, fakeReply);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.user).toEqual({ id: 'user-cache', role: 'COURIER' });
  });

  it('re-reads the database after eviction and rejects a token the change invalidated (#12)', async () => {
    const spy = vi.spyOn(getPrismaClient().user, 'findUnique');
    spy.mockResolvedValueOnce({ role: 'COURIER', tokenVersion: 1 } as never);
    const token = signAccessToken({ sub: 'user-evict', role: 'COURIER', tokenVersion: 1 });
    await authenticate(fakeRequest(`Bearer ${token}`), fakeReply);
    expect(spy).toHaveBeenCalledTimes(1);

    // Simulates what `updateUserRole` does post-commit (#369): the cached
    // entry is evicted and the database row now carries a bumped
    // tokenVersion — the very token that passed a moment ago must now fail.
    cacheEntries.delete('user-evict');
    spy.mockResolvedValueOnce({ role: 'CUSTOMER', tokenVersion: 2 } as never);

    await expect(authenticate(fakeRequest(`Bearer ${token}`), fakeReply)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('trusts the cached role as much as the database one — never the token claim', async () => {
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValue({
      role: 'CUSTOMER',
      tokenVersion: 5,
    } as never);
    // First request populates the cache from the DB read above.
    await authenticate(
      fakeRequest(
        `Bearer ${signAccessToken({ sub: 'user-role', role: 'ADMIN', tokenVersion: 5 })}`,
      ),
      fakeReply,
    );

    // Second request is served entirely from cache — still CUSTOMER, never
    // the token's stale ADMIN claim.
    const request = fakeRequest(
      `Bearer ${signAccessToken({ sub: 'user-role', role: 'ADMIN', tokenVersion: 5 })}`,
    );
    await authenticate(request, fakeReply);
    expect(request.user).toEqual({ id: 'user-role', role: 'CUSTOMER' });
  });

  it('never caches a user that no longer exists — every such request re-checks the database', async () => {
    const spy = vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValue(null);
    const token = signAccessToken({ sub: 'deleted-user', role: 'ADMIN', tokenVersion: 0 });

    await expect(authenticate(fakeRequest(`Bearer ${token}`), fakeReply)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(authenticate(fakeRequest(`Bearer ${token}`), fakeReply)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(cacheEntries.size).toBe(0);
  });
});

describe('authenticate — case-insensitive Bearer scheme (#463)', () => {
  it('accepts lowercase bearer and uppercase BEARER schemes per RFC 6750', async () => {
    vi.spyOn(getPrismaClient().user, 'findUnique').mockResolvedValue({
      role: 'CUSTOMER',
      tokenVersion: 0,
    } as never);
    const token = signAccessToken({ sub: 'user-1', role: 'CUSTOMER', tokenVersion: 0 });

    for (const prefix of ['bearer', 'Bearer', 'BEARER']) {
      const request = fakeRequest(`${prefix} ${token}`);
      await authenticate(request, fakeReply);
      expect(request.user).toEqual({ id: 'user-1', role: 'CUSTOMER' });
    }
  });
});
