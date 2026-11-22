import type { PrismaClient } from '@prisma/client';

export interface ListAuditLogFilters {
  action?: string;
  targetType?: string;
  actorId?: string;
}

export interface ListAuditLogInput {
  page?: number;
  limit?: number;
  cursor?: string;
  includeTotal?: boolean;
  filters?: ListAuditLogFilters;
}

export interface ListAuditLogResult {
  rows: Array<{
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    actorId: string | null;
    createdAt: Date;
  }>;
  total?: number;
  hasNextPage: boolean;
  nextCursor: string | null;
}

export interface ListAuditLogDeps {
  prisma: Pick<PrismaClient, 'auditLog'>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_EXACT_COUNT_PAGE = 10;

export function createListAuditLogUseCase(deps: ListAuditLogDeps) {
  return async function listAuditLog(input: ListAuditLogInput = {}): Promise<ListAuditLogResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(input.page ?? 1, 1);
    const cursor = input.cursor;

    const where: Record<string, unknown> = {};
    if (input.filters?.action) where.action = input.filters.action;
    if (input.filters?.targetType) where.targetType = input.filters.targetType;
    if (input.filters?.actorId) where.actorId = input.filters.actorId;

    const useCursor = Boolean(cursor);
    const skip = useCursor ? 1 : (page - 1) * limit;

    const findManyArgs: Record<string, unknown> = {
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    };
    if (useCursor) {
      findManyArgs.cursor = { id: cursor };
      findManyArgs.skip = skip;
    } else if (skip > 0) {
      findManyArgs.skip = skip;
    }

    const shouldCount =
      input.includeTotal === true && !useCursor && page <= MAX_EXACT_COUNT_PAGE;

    const [rows, total] = await Promise.all([
      deps.prisma.auditLog.findMany(findManyArgs as never),
      shouldCount ? deps.prisma.auditLog.count({ where }) : Promise.resolve(undefined),
    ]);

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage ? pageRows[pageRows.length - 1]?.id ?? null : null;

    return {
      rows: pageRows,
      total,
      hasNextPage,
      nextCursor,
    };
  };
}
