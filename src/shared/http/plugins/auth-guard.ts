import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../../jwt/index.js';
import { UnauthorizedError, ForbiddenError } from '../../errors/index.js';
import { getPrismaClient } from '../../database/index.js';
import { readAuthContext, writeAuthContext } from '../../cache/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; role: UserRole };
  }
}

/**
 * Route-level auth guard — attached per-route via `{ preHandler: authenticate }`,
 * not globally, so public routes (register/login) stay public without an
 * allow-list of exceptions to maintain. Verifies the bearer access token and
 * attaches the claims to `request.user` for downstream handlers/guards.
 *
 * Access tokens are otherwise fully stateless (signature + expiry only, per
 * docs/AUTHENTICATION.md) — this `users.token_version` check is the one
 * deliberate exception, closing security issue #12: without it, an
 * already-issued access token keeps granting its original role for the
 * rest of its ~15-minute lifetime even after an admin changes that user's
 * role, since the role is otherwise only ever read from the token's own
 * (now-stale) claim. `updateUserRole` bumps `token_version` on every role
 * change, so this rejects any token issued before that change on its very
 * next request — not just at token expiry or next refresh. `role` is read
 * fresh from this same lookup (not from the token's claim) as defense in
 * depth, at no extra cost since the row is already being fetched.
 *
 * The `role`/`tokenVersion` pair is served from a short-TTL Redis cache
 * first (#369, `shared/cache/auth-context-cache.ts`) so the check doesn't
 * cost one `users` lookup per authenticated request under load. Two
 * properties keep the #12 guarantee intact despite the cache: (1) role
 * changes evict the entry the moment their transaction commits
 * (`AuthCacheInvalidator`, wired in `src/modules/admin`) — the TTL is only
 * a backstop for eviction failures, never the primary invalidation path;
 * (2) every cache failure (outage, corrupt entry) degrades to the original
 * per-request database lookup rather than skipping the check — an
 * unreachable cache must never widen privileges or reject valid requests.
 *
 * Uses the shared Prisma singleton directly (matching the existing
 * `shared/http/routes/health.ts` precedent) rather than threading a
 * dependency through every one of this function's ~10 call sites — it's
 * referenced by bare function identity (`preHandler: authenticate`)
 * throughout the codebase, so changing its signature would mean touching
 * every route file and module composition root for a single security check.
 */
export const authGuard = {
  async authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization?.trim();
    if (!header) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const match = /^bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const token = match[1].trim();

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }

  let currentUser = await readAuthContext(claims.sub);
  if (!currentUser) {
    const row = await getPrismaClient().user.findUnique({
      where: { id: claims.sub },
      select: { role: true, tokenVersion: true },
    });
    if (row) {
      currentUser = { role: row.role, tokenVersion: row.tokenVersion };
      await writeAuthContext(claims.sub, currentUser);
    }
  }

    // Tokens issued before `tokenVersion` existed carry no such claim —
    // treated as version 0 (the column's default) so they keep working
    // rather than being force-invalidated by this change's own deploy.
    if (!currentUser || currentUser.tokenVersion !== (claims.tokenVersion ?? 0)) {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    request.user = { id: claims.sub, role: currentUser.role };
  },
};

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return authGuard.authenticate(request, reply);
}

/**
 * Role guard — compose after `authenticate` in a route's `preHandler` array,
 * e.g. `{ preHandler: [authenticate, requireRole('ADMIN')] }`.
 */
export function requireRole(...roles: UserRole[]) {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required before role check');
    }
    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError('Insufficient role for this operation');
    }
  };
}

/**
 * Narrows `request.user` (populated by {@link authenticate}) to a non-null
 * value inside a route handler body, so `request.user.id` is never read
 * through a non-null assertion. Unreachable in practice on any route that
 * lists `authenticate` in its `preHandler`s — that guard throws before the
 * handler runs — but kept as a defence-in-depth check on the authorization
 * surface every protected route shares.
 */
export function requireUser(request: FastifyRequest): { id: string; role: UserRole } {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }
  return request.user;
}
