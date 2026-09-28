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

/**
 * Creates the use case for listing admin audit log entries.
 *
 * The returned function fetches a page of audit log entries from the injected
 * repository using `before`-cursor keyset pagination (same shape as the
 * `notifications` list endpoint — see #101). The requested `limit` is clamped
 * to `MAX_LIMIT` (200) and defaults to `DEFAULT_LIMIT` (50) when omitted.
 *
 * @param deps - Use case dependencies; requires an `auditLogRepository` used
 *   to read the audit log entries.
 * @returns An async function that accepts an optional {@link ListAuditLogInput}
 *   (`limit` and ISO `before` cursor) and resolves to a
 *   {@link ListAuditLogResult} containing the page `items`, the `nextCursor`
 *   for the following page (or `null` when there are no more rows), and the
 *   effective `limit` that was applied.
 */
export function createListAuditLogUseCase(deps: ListAuditLogDeps) {
  return async function listAuditLog(input: ListAuditLogInput = {}): Promise<ListAuditLogResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const items = await deps.auditLogRepository.list({
      limit,
      ...(input.before && { before: new Date(input.before) }),
    });

    const lastItem = items[items.length - 1];
    const nextCursor =
      items.length === limit && lastItem ? lastItem.createdAt.toISOString() : null;

    return { items, nextCursor, limit };
  };
}
