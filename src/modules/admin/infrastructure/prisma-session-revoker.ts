import type { PrismaClient } from '@prisma/client';
import type { SessionRevoker } from '../domain/index.js';

/**
 * Real `SessionRevoker` (see that port's doc comment) — touches
 * `refresh_tokens` and `users` directly rather than going through `auth`'s
 * own repositories/use cases, same "genuinely shared identity state, third
 * module to touch it" rationale `UserRoleRepository` already documents.
 * Both writes run in one transaction: a role change must never end up
 * revoking refresh tokens without also bumping `token_version` (or vice
 * versa), or one of the two invalidation paths silently stays open.
 */
export function createPrismaSessionRevoker(prisma: PrismaClient): SessionRevoker {
  return {
    async revokeAllForUser(userId) {
      await prisma.$transaction([
        prisma.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { tokenVersion: { increment: 1 } },
        }),
      ]);
    },
  };
}
