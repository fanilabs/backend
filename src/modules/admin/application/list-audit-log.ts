import type { AuditLogEntry, AuditLogRepository } from '../domain/index.js';

export interface ListAuditLogDeps {
  auditLogRepository: AuditLogRepository;
}

export interface ListAuditLogInput {
  limit?: number;
  /** ISO timestamp cursor — the previous page's `nextCursor`. */
  before?: string;
}

export interface ListAuditLogResult {
  items: AuditLogEntry[];
  nextCursor: string | null;
  limit: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Same `before`-cursor keyset pagination as `notifications`' identically
 * shaped list endpoint — see #101; the two were flagged together since
 * both capped at `MAX_LIMIT` with no way to reach older rows. */
export function createListAuditLogUseCase(deps: ListAuditLogDeps) {
  return async function listAuditLog(input: ListAuditLogInput = {}): Promise<ListAuditLogResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const items = await deps.auditLogRepository.list({
      limit,
      ...(input.before && { before: new Date(input.before) }),
    });

    const nextCursor = items.length === limit ? items[items.length - 1].createdAt.toISOString() : null;

    return { items, nextCursor, limit };
  };
}
