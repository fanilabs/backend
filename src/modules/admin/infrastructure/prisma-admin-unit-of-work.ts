import type { PrismaClient } from '@prisma/client';
import type { AdminUnitOfWork } from '../domain/index.js';
import { createPrismaAuditLogRepository } from './prisma-audit-log-repository.js';
import { createPrismaSessionRevoker } from './prisma-session-revoker.js';
import { createPrismaUserRoleRepository } from './prisma-user-role-repository.js';

/**
 * Real `AdminUnitOfWork` — Prisma's *interactive* `$transaction`, so the
 * callback is handed adapters bound to the transaction-scoped `tx` client
 * rather than the root one. Every write they perform (the role update, the
 * session revocation, the audit-log insert in `updateUserRole`, #276) is
 * therefore committed or rolled back as one unit: a crash or a failure
 * anywhere inside can never leave a privilege change committed without its
 * audit-log entry.
 */
export function createPrismaAdminUnitOfWork(prisma: PrismaClient): AdminUnitOfWork {
  return {
    async run(work) {
      return prisma.$transaction(async (tx) =>
        work({
          userRoleRepository: createPrismaUserRoleRepository(tx),
          auditLogRepository: createPrismaAuditLogRepository(tx),
          sessionRevoker: createPrismaSessionRevoker(tx),
        }),
      );
    },
  };
}
