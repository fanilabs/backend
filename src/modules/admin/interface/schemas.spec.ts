import { describe, expect, it } from 'vitest';
import { listAuditLogQuerySchema, listAuditLogResponseSchema } from './schemas.js';

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
      meta: { limit: 50, nextCursor: null, totalCount: 1 },
    });

    expect(result.success).toBe(true);
  });

  it('rejects entity types longer than the maximum length', () => {
    const result = listAuditLogResponseSchema.safeParse({
      data: [{ ...entry, entityType: 'A'.repeat(101) }],
      meta: { limit: 50, nextCursor: null, totalCount: 1 },
    });

    expect(result.success).toBe(false);
  });

  it('requires totalCount in meta (#292)', () => {
    const result = listAuditLogResponseSchema.safeParse({
      data: [entry],
      meta: { limit: 50, nextCursor: null },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-integer totalCount', () => {
    const result = listAuditLogResponseSchema.safeParse({
      data: [entry],
      meta: { limit: 50, nextCursor: null, totalCount: 1.5 },
    });

    expect(result.success).toBe(false);
  });
});

describe('listAuditLogQuerySchema', () => {
  it('accepts limit, before, actorId and action together', () => {
    const result = listAuditLogQuerySchema.safeParse({
      limit: 25,
      before: '70b85a76-e3f9-4c34-a8b8-a5a39bf86870',
      actorId: '70b85a76-e3f9-4c34-a8b8-a5a39bf86870',
      action: 'user.role_updated',
    });

    expect(result.success).toBe(true);
  });

  it('accepts omitted filters (unfiltered behavior preserved)', () => {
    const result = listAuditLogQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it('rejects an invalid actorId', () => {
    const result = listAuditLogQuerySchema.safeParse({ actorId: 'not-a-uuid' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toContain('actorId');
  });

  it('rejects an empty action', () => {
    const result = listAuditLogQuerySchema.safeParse({ action: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toContain('action');
  });

  it('rejects an action longer than 100 characters', () => {
    const result = listAuditLogQuerySchema.safeParse({ action: 'a'.repeat(101) });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toContain('action');
  });

  it('accepts an action of exactly 100 characters', () => {
    const result = listAuditLogQuerySchema.safeParse({ action: 'a'.repeat(100) });

    expect(result.success).toBe(true);
  });
});
