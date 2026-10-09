import { randomUUID } from 'node:crypto';
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

  it('returns a nextCursor equal to the last item id when a full page is returned', async () => {
    const auditLogRepository = createInMemoryAuditLogRepository();
    for (let i = 0; i < 5; i += 1) {
      await auditLogRepository.record({
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: `action-${i}`,
        entityType: 'User',
        entityId: `user-${i}`,
      });
    }
    const listAuditLog = createListAuditLogUseCase({ auditLogRepository });

    const result = await listAuditLog({ limit: 3 });

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBe(result.items[2]!.id);
  });

  it('returns nextCursor=null when the last page is partial', async () => {
    const auditLogRepository = createInMemoryAuditLogRepository();
    for (let i = 0; i < 3; i += 1) {
      await auditLogRepository.record({
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: `action-${i}`,
        entityType: 'User',
        entityId: `user-${i}`,
      });
    }
    const listAuditLog = createListAuditLogUseCase({ auditLogRepository });

    const result = await listAuditLog({ limit: 10 });

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it('pages through all records using ID cursors without duplicates or gaps', async () => {
    const auditLogRepository = createInMemoryAuditLogRepository();
    for (let i = 0; i < 7; i += 1) {
      await auditLogRepository.record({
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: `action-${i}`,
        entityType: 'User',
        entityId: `user-${i}`,
      });
    }
    const listAuditLog = createListAuditLogUseCase({ auditLogRepository });

    const page1 = await listAuditLog({ limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listAuditLog({ limit: 3, before: page1.nextCursor! });
    expect(page2.items).toHaveLength(3);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await listAuditLog({ limit: 3, before: page2.nextCursor! });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    // No duplicates and no gaps across all three pages.
    const allIds = [...page1.items, ...page2.items, ...page3.items].map((e) => e.id);
    expect(new Set(allIds).size).toBe(7);
  });

  it('does not skip records when two entries share the exact same millisecond timestamp', async () => {
    // Seed two entries with identical createdAt. The in-memory fake
    // uses the same sort key (createdAt, then id desc) as the Prisma
    // repository, so this exercises the tiebreaker that prevents the
    // same-millisecond skip bug.
    const sharedTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const idA = randomUUID();
    const idB = randomUUID();
    // idB > idA lexicographically guarantees a predictable order under the desc id sort.
    const [firstId, secondId] = [idA, idB].sort().reverse() as [string, string];

    const auditLogRepository = createInMemoryAuditLogRepository();
    // Inject entries directly so we can control both id and createdAt.
    auditLogRepository.restore([
      {
        id: firstId,
        actorId: null,
        actorLabel: 'system',
        action: 'first',
        entityType: 'User',
        entityId: 'u1',
        metadata: null,
        createdAt: sharedTimestamp,
      },
      {
        id: secondId,
        actorId: null,
        actorLabel: 'system',
        action: 'second',
        entityType: 'User',
        entityId: 'u2',
        metadata: null,
        createdAt: sharedTimestamp,
      },
    ]);

    const listAuditLog = createListAuditLogUseCase({ auditLogRepository });

    const page1 = await listAuditLog({ limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listAuditLog({ limit: 1, before: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);

    // Both entries must be seen; the second one must NOT be skipped.
    expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
    const seenIds = new Set([page1.items[0]!.id, page2.items[0]!.id]);
    expect(seenIds).toContain(firstId);
    expect(seenIds).toContain(secondId);
  });
});
