import { describe, expect, it } from 'vitest';
import { createListAuditLogUseCase } from './list-audit-log.js';
import { createInMemoryAuditLogRepository } from './__fixtures__/fakes.js';

describe('listAuditLog', () => {
  it('defaults to a limit of 50', async () => {
    const auditLogRepository = createInMemoryAuditLogRepository();
    for (let i = 0; i < 60; i += 1) {
      await auditLogRepository.record({
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: 'user.role_updated',
        entityType: 'User',
        entityId: `user-${i}`,
      });
    }
    const listAuditLog = createListAuditLogUseCase({ auditLogRepository });

    const result = await listAuditLog();

    expect(result).toHaveLength(50);
  });

  it('caps limit at 200 even if a larger value is requested', async () => {
    const auditLogRepository = createInMemoryAuditLogRepository();
    for (let i = 0; i < 250; i += 1) {
      await auditLogRepository.record({
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: 'user.role_updated',
        entityType: 'User',
        entityId: `user-${i}`,
      });
    }
    const listAuditLog = createListAuditLogUseCase({ auditLogRepository });

    const result = await listAuditLog({ limit: 1000 });

    expect(result).toHaveLength(200);
  });
});
