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

/** Authentication checks role and tokenVersion against the authoritative primary
 * database on every request. Cached state cannot authorize a revoked credential.
 * Requests whose DB check precedes a reset commit may already be in flight;
 * checks after commit reject old tokens, across instances and Redis failures.
 * Database errors fail closed. Do not point this lookup at a lagging replica.
 */
export const authGuard = {
  async authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
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
