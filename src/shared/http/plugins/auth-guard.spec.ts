import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './auth-guard.js';
import { signAccessToken } from '../../jwt/index.js';
import { getPrismaClient } from '../../database/index.js';
import { UnauthorizedError } from '../../errors/index.js';

/**
 * Unit coverage for `authenticate`'s DB-backed `tokenVersion` check
 * (security issue #12) — stubs the shared Prisma singleton's `user.findUnique`
 * directly (same instance `authenticate` itself calls, since
 * `getPrismaClient()` is memoized) rather than mocking the whole module, so
 * this exercises the real guard logic without a live database.
 */
function fakeRequest(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as unknown as FastifyRequest;
}

const fakeReply = {} as FastifyReply;

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

  it('trusts the freshly-read DB role over the token\'s own (potentially stale) role claim', async () => {
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
