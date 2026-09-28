import { describe, expect, it } from 'vitest';
import { listAuditLogResponseSchema } from './schemas.js';

describe('listAuditLogResponseSchema', () => {
  const response = (entityId: string) => ({
    data: [
      {
        id: '00000000-0000-4000-8000-000000000000',
        actorId: null,
        actorLabel: 'system',
        action: 'user.role_updated',
        entityType: 'User',
        entityId,
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    meta: { limit: 100, nextCursor: null },
  });

  it('accepts entity IDs up to 255 characters', () => {
    expect(listAuditLogResponseSchema.safeParse(response('x'.repeat(255))).success).toBe(true);
  });

  it('rejects entity IDs longer than 255 characters', () => {
    expect(listAuditLogResponseSchema.safeParse(response('x'.repeat(256))).success).toBe(false);
  });
});
