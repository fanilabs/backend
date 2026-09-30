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

    // #292 — totalCount is the unpaged total, not the page length.
    expect(result.totalCount).toBe(60);
    expect(result.items).toHaveLength(50);
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

    expect(result.items).toHaveLength(200);
    // totalCount stays the full total regardless of the requested/capped page size.
    expect(result.totalCount).toBe(250);
  });

  it('reports totalCount of 0 for an empty audit log (#292)', async () => {
    const listAuditLog = createListAuditLogUseCase({
      auditLogRepository: createInMemoryAuditLogRepository(),
    });

    const result = await listAuditLog();

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.totalCount).toBe(0);
  });
});
