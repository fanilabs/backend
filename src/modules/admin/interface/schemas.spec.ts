import { describe, expect, it } from 'vitest';
import { listAuditLogResponseSchema } from './schemas.js';

describe('listAuditLogResponseSchema', () => {
  it('limits actorLabel to 255 characters', () => {
    const response = {
      data: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          actorId: null,
          actorLabel: 'a'.repeat(256),
          action: 'USER_ROLE_UPDATED',
          entityType: 'User',
          entityId: '00000000-0000-4000-8000-000000000002',
          metadata: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      meta: { limit: 50, nextCursor: null },
    };

    expect(listAuditLogResponseSchema.safeParse(response).success).toBe(false);
  });
});
