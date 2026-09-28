/**
 * Consistent success envelope used across every module's routes
 * (ARCHITECTURE.md §9). Errors are handled separately by
 * src/shared/errors/error-handler.ts and never go through this helper.
 */
export interface SuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Overloaded so a caller that passes `meta` gets it back typed exactly as
 * given (e.g. `{ limit: number; nextCursor: string | null }`), not widened
 * to `SuccessResponse<T>`'s generic `Record<string, unknown>` — routes with
 * a Zod response schema that requires a specific `meta` shape (pagination
 * envelopes) need that precision to type-check against `reply.send(...)`.
 */
export function ok<T>(data: T): SuccessResponse<T>;
export function ok<T, M extends Record<string, unknown>>(data: T, meta: M): { data: T; meta: M };
export function ok<T, M extends Record<string, unknown>>(
  data: T,
  meta?: M,
): SuccessResponse<T> | { data: T; meta: M } {
  return meta ? { data, meta } : { data };
}
