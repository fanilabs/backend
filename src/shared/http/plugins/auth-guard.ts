import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../../jwt/index.js';
import { UnauthorizedError, ForbiddenError } from '../../errors/index.js';
import { getPrismaClient } from '../../database/index.js';

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
 * Uses the shared Prisma singleton directly (matching the existing
 * `shared/http/routes/health.ts` precedent) rather than threading a
 * dependency through every one of this function's ~10 call sites — it's
 * referenced by bare function identity (`preHandler: authenticate`)
 * throughout the codebase, so changing its signature would mean touching
 * every route file and module composition root for a single security check.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length);

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }

  const currentUser = await getPrismaClient().user.findUnique({
    where: { id: claims.sub },
    select: { role: true, tokenVersion: true },
  });

  // Tokens issued before `tokenVersion` existed carry no such claim —
  // treated as version 0 (the column's default) so they keep working
  // rather than being force-invalidated by this change's own deploy.
  if (!currentUser || currentUser.tokenVersion !== (claims.tokenVersion ?? 0)) {
    throw new UnauthorizedError('Invalid or expired access token');
  }

  request.user = { id: claims.sub, role: currentUser.role };
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
