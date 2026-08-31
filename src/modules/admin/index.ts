import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  createListAuditLogUseCase,
  createListOpenDisputesUseCase,
  createUpdateUserRoleUseCase,
} from './application/index.js';
import {
  createPrismaAuditLogRepository,
  createPrismaDisputeReviewReader,
  createPrismaUserRoleRepository,
} from './infrastructure/index.js';
import { createAdminRoutes } from './interface/routes.js';

/** No blockchain-event subscription, unlike most other modules — `admin`
 * is thin orchestration over other modules' already-synced read models
 * plus its own off-chain-only role/audit-log state, not something the
 * chain has an event for. Nothing for `src/workers/index.ts` to wire. */
export function createAdminModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const disputeReviewReader = createPrismaDisputeReviewReader(prisma);
  const userRoleRepository = createPrismaUserRoleRepository(prisma);
  const auditLogRepository = createPrismaAuditLogRepository(prisma);

  const useCases = {
    listOpenDisputes: createListOpenDisputesUseCase({ disputeReviewReader }),
    updateUserRole: createUpdateUserRoleUseCase({ userRoleRepository, auditLogRepository }),
    listAuditLog: createListAuditLogUseCase({ auditLogRepository }),
  };

  return createAdminRoutes(useCases);
}
