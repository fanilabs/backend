import { describe, expect, it } from 'vitest';
import { listAuditLogResponseSchema } from './schemas.js';

describe('listAuditLogResponseSchema', () => {
  const entry = {
    id: '70b85a76-e3f9-4c34-a8b8-a5a39bf86870',
    actorId: null,
    actorLabel: 'System',
    action: 'user.role_updated',
    entityType: 'User',
    entityId: 'user-id',
    metadata: null,
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts entity types up to the maximum length', () => {
    const result = listAuditLogResponseSchema.safeParse({
      data: [{ ...entry, entityType: 'A'.repeat(100) }],
      meta: { limit: 50, nextCursor: null },
    });

    expect(result.success).toBe(true);
  });

  it('rejects entity types longer than the maximum length', () => {
    const result = listAuditLogResponseSchema.safeParse({
      data: [{ ...entry, entityType: 'A'.repeat(101) }],
      meta: { limit: 50, nextCursor: null },
    });

    expect(result.success).toBe(false);
  });
});
