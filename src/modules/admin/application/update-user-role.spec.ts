import { describe, expect, it } from 'vitest';
import { createUpdateUserRoleUseCase } from './update-user-role.js';
import { AdminUserNotFoundError } from '../domain/index.js';
import {
  buildAdminUser,
  createInMemoryAdminUnitOfWork,
  createInMemoryAuditLogRepository,
  createInMemoryUserRoleRepository,
  createFakeSessionRevoker,
} from './__fixtures__/fakes.js';

function setup() {
  const userRoleRepository = createInMemoryUserRoleRepository();
  const auditLogRepository = createInMemoryAuditLogRepository();
  const sessionRevoker = createFakeSessionRevoker();
  const unitOfWork = createInMemoryAdminUnitOfWork({
    userRoleRepository,
    auditLogRepository,
    sessionRevoker,
  });
  const updateUserRole = createUpdateUserRoleUseCase({ unitOfWork });
  return { userRoleRepository, auditLogRepository, sessionRevoker, updateUserRole };
}

describe('updateUserRole', () => {
  it('updates the role and returns the updated user', async () => {
    const { userRoleRepository, updateUserRole } = setup();
    const target = buildAdminUser({ id: 'target-1', role: 'CUSTOMER' });
    const actor = buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });
    userRoleRepository.seed(target);
    userRoleRepository.seed(actor);

    const result = await updateUserRole({
      actorId: 'admin-1',
      userId: 'target-1',
      role: 'COURIER',
    });

    expect(result.role).toBe('COURIER');
    expect((await userRoleRepository.findById('target-1'))?.role).toBe('COURIER');
  });

  it('records an audit log entry with the acting admin, previous role, and new role', async () => {
    const { userRoleRepository, auditLogRepository, updateUserRole } = setup();
    userRoleRepository.seed(buildAdminUser({ id: 'target-1', role: 'CUSTOMER' }));
    userRoleRepository.seed(
      buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' }),
    );

    await updateUserRole({ actorId: 'admin-1', userId: 'target-1', role: 'FLEET_MANAGER' });

    expect(auditLogRepository.all()).toMatchObject([
      {
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: 'user.role_updated',
        entityType: 'User',
        entityId: 'target-1',
        metadata: { previousRole: 'CUSTOMER', newRole: 'FLEET_MANAGER' },
      },
    ]);
  });

  it('throws AdminUserNotFoundError for an unknown target user', async () => {
    const { updateUserRole } = setup();

    await expect(
      updateUserRole({ actorId: 'admin-1', userId: 'missing', role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(AdminUserNotFoundError);
  });

  it('revokes all sessions for the target user when their role is changed', async () => {
    const { userRoleRepository, sessionRevoker, updateUserRole } = setup();
    const target = buildAdminUser({ id: 'target-1', role: 'CUSTOMER' });
    const actor = buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });
    userRoleRepository.seed(target);
    userRoleRepository.seed(actor);

    await updateUserRole({
      actorId: 'admin-1',
      userId: 'target-1',
      role: 'ADMIN',
    });

    expect(sessionRevoker.wasCalledFor('target-1')).toBe(true);
  });

  // Issue #276: the role update, the session revocation, and the audit-log
  // insert must commit or roll back as one unit — a crash (or a failing
  // audit insert) must never leave a privilege change with no audit record.
  it('rolls back the role change and session revocation when the audit log write fails', async () => {
    const { userRoleRepository, auditLogRepository, sessionRevoker } = setup();
    userRoleRepository.seed(buildAdminUser({ id: 'target-1', role: 'CUSTOMER' }));
    userRoleRepository.seed(
      buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' }),
    );
    const updateUserRole = createUpdateUserRoleUseCase({
      unitOfWork: createInMemoryAdminUnitOfWork({
        userRoleRepository,
        auditLogRepository: {
          ...auditLogRepository,
          record: async () => {
            throw new Error('audit log insert failed');
          },
        },
        sessionRevoker,
      }),
    });

    await expect(
      updateUserRole({ actorId: 'admin-1', userId: 'target-1', role: 'COURIER' }),
    ).rejects.toThrow('audit log insert failed');

    expect((await userRoleRepository.findById('target-1'))?.role).toBe('CUSTOMER');
    expect(sessionRevoker.wasCalledFor('target-1')).toBe(false);
  });
});
