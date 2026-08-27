import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../../jwt/index.js';
import { UnauthorizedError, ForbiddenError } from '../../errors/index.js';

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
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length);

  try {
    const claims = verifyAccessToken(token);
    request.user = { id: claims.sub, role: claims.role };
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
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
