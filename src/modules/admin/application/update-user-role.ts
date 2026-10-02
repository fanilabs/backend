import type { AdminUnitOfWork, AdminUser, UserRole } from '../domain/index.js';
import {
  AdminUserNotFoundError,
  CannotChangeOwnRoleError,
  LastAdministratorError,
} from '../domain/index.js';

export interface UpdateUserRoleDeps {
  unitOfWork: AdminUnitOfWork;
}

export interface UpdateUserRoleInput {
  actorId: string;
  userId: string;
  role: UserRole;
}

/**
 * Every call writes an `AuditLog` row, whether or not the role actually
 * changed — an admin *attempting* to set a role is itself worth recording,
 * not just successful mutations. `actorLabel` is the acting admin's own
 * email, looked up via the same `UserRoleRepository` rather than trusting
 * a client-supplied label, so the audit trail can't be spoofed by
 * whatever the request happens to send.
 *
 * The whole thing runs inside one `AdminUnitOfWork` (#276): the role
 * write, the session revocation, and the audit-log insert either all commit
 * or none do. Sequential awaits here would let a crash (or a failing audit
 * insert) leave a privilege change committed with no record of who made it.
 */
export function createUpdateUserRoleUseCase(deps: UpdateUserRoleDeps) {
  return async function updateUserRole(input: UpdateUserRoleInput): Promise<AdminUser> {
    return deps.unitOfWork.run(
      async ({ userRoleRepository, auditLogRepository, sessionRevoker }) => {
        const target = await userRoleRepository.findById(input.userId);
        if (!target) throw new AdminUserNotFoundError();

        if (input.actorId === input.userId) {
          throw new CannotChangeOwnRoleError();
        }

        if (target.role === 'ADMIN' && input.role !== 'ADMIN') {
          const adminCount = await userRoleRepository.countByRole('ADMIN');
          if (adminCount <= 1) {
            throw new LastAdministratorError();
          }
        }

        await userRoleRepository.updateRole(input.userId, input.role);

        // Security issue #12: a role change must take effect immediately, not
        // just for future logins/refreshes — see `SessionRevoker`'s doc
        // comment for what this actually closes (stale refresh tokens *and*
        // already-issued access tokens, via `users.token_version`).
        await sessionRevoker.revokeAllForUser(input.userId);

        const actor = await userRoleRepository.findById(input.actorId);
        await auditLogRepository.record({
          actorId: input.actorId,
          actorLabel: actor?.email ?? input.actorId,
          action: 'user.role_updated',
          entityType: 'User',
          entityId: input.userId,
          metadata: { previousRole: target.role, newRole: input.role },
        });

        return { ...target, role: input.role };
      },
    );
  };
}
