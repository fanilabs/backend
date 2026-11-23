import type { AuditLogEntry, AuditLogRepository, ListAuditLogFilter } from '../domain/index.js';

export interface ListAuditLogFilters {
  actorId?: string;
  action?: string;
}

export interface ListAuditLogInput {
  limit?: number;
  /** ID of the last row from the previous page, used as a stable cursor. */
  before?: string;
  filters?: ListAuditLogFilters;
}

export interface ListAuditLogResult {
  items: AuditLogEntry[];
  nextCursor: string | null;
  /** Effective page size after clamping to `MAX_LIMIT` — echoed back in the
   * response envelope. */
  limit: number;
  /** Unpaged total number of rows matching `filters` (#292). */
  totalCount: number;
}

export interface ListAuditLogDeps {
  auditLogRepository: AuditLogRepository;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createListAuditLogUseCase(deps: ListAuditLogDeps) {
  return async function listAuditLog(input: ListAuditLogInput = {}): Promise<ListAuditLogResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const { before, filters } = input;

    const listFilter: ListAuditLogFilter = {
      limit: limit + 1,
      ...(before !== undefined && { before }),
      ...(filters?.actorId !== undefined && { actorId: filters.actorId }),
      ...(filters?.action !== undefined && { action: filters.action }),
    };

    // Ask for one extra row so we can detect a following page without a
    // separate count query; the cursor ties back to the last returned id.
    const rows = await deps.auditLogRepository.list(listFilter);

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage ? items[items.length - 1]?.id ?? null : null;

    // totalCount reflects the filtered result set, not the page.
    const countFilter: ListAuditLogFilter = {
      ...(filters?.actorId !== undefined && { actorId: filters.actorId }),
      ...(filters?.action !== undefined && { action: filters.action }),
    };
    const totalCount = await deps.auditLogRepository.count(countFilter);

    return { items, nextCursor, limit, totalCount };
  };
}
