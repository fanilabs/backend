import type {
  AdminUser,
  AuditLogRepository,
  UserRole,
  UserRoleRepository,
} from '../domain/index.js';
import {
  AdminUserNotFoundError,
  CannotChangeOwnRoleError,
  LastAdministratorError,
} from '../domain/index.js';

export interface UpdateUserRoleDeps {
  userRoleRepository: UserRoleRepository;
  auditLogRepository: AuditLogRepository;
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
 */
export function createUpdateUserRoleUseCase(deps: UpdateUserRoleDeps) {
  return async function updateUserRole(input: UpdateUserRoleInput): Promise<AdminUser> {
    const target = await deps.userRoleRepository.findById(input.userId);
    if (!target) throw new AdminUserNotFoundError();

    if (input.actorId === input.userId) {
      throw new CannotChangeOwnRoleError();
    }

    if (target.role === 'ADMIN' && input.role !== 'ADMIN') {
      const adminCount = await deps.userRoleRepository.countByRole('ADMIN');
      if (adminCount <= 1) {
        throw new LastAdministratorError();
      }
    }

    await deps.userRoleRepository.updateRole(input.userId, input.role);

    const actor = await deps.userRoleRepository.findById(input.actorId);
    await deps.auditLogRepository.record({
      actorId: input.actorId,
      actorLabel: actor?.email ?? input.actorId,
      action: 'user.role_updated',
      entityType: 'User',
      entityId: input.userId,
      metadata: { previousRole: target.role, newRole: input.role },
    });

    return { ...target, role: input.role };
  };
}
