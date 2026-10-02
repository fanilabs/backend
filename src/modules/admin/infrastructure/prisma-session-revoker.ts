import type { Prisma } from '@prisma/client';
import type { SessionRevoker } from '../domain/index.js';

/**
 * Real `SessionRevoker` (see that port's doc comment) — touches
 * `refresh_tokens` and `users` directly rather than going through `auth`'s
 * own repositories/use cases, same "genuinely shared identity state, third
 * module to touch it" rationale `UserRoleRepository` already documents.
 *
 * Both writes run in one transaction: a role change must never end up
 * revoking refresh tokens without also bumping `token_version` (or vice
 * versa), or one of the two invalidation paths silently stays open. Since
 * #276 that transaction is the *enclosing* `AdminUnitOfWork` one (a Prisma
 * `tx` client cannot open a nested `$transaction`), so these two statements
 * simply execute inside it and are atomic with the role write and the
 * audit-log insert around them.
 */
export function createPrismaSessionRevoker(prisma: Prisma.TransactionClient): SessionRevoker {
  return {
    async revokeAllForUser(userId) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });
    },
  };
}
