import type { AdminUser, AuditLogEntry, DisputeReviewItem, UserRole } from './entities.js';

/**
 * Reads `disputes`/`deliveries`/`evidence` directly for an admin-focused
 * "what needs review" view — a dispute review UI backend, per
 * `ARCHITECTURE.md` §4, not a duplicate of `disputes`' own per-delivery
 * `GET /disputes/:chainDeliveryId` (still the place to fetch one dispute's
 * full evidence-download detail once an admin picks one from this list).
 * The same documented, `ARCHITECTURE.md` §10-diagrammed exception
 * `analytics` already established for reading other modules' read models
 * directly rather than reaching into a use case that doesn't exist for
 * this shape.
 */
export interface DisputeReviewReader {
  listOpenDisputes(filter: {
    limit: number;
    after?: { raisedAt: Date; chainDeliveryId: bigint };
  }): Promise<DisputeReviewItem[]>;
}

/**
 * Touches the shared `users` table directly — the third module to do so
 * (after `auth` and `users` themselves), for the same reason `notifications`
 * documents for its own `UserContactLookup`: role is genuinely shared
 * identity state, not `users`-module-private domain data, and no other
 * module exposes a role-assignment capability at all.
 */
export interface UserRoleRepository {
  findById(userId: string): Promise<AdminUser | null>;
  updateRole(userId: string, role: UserRole): Promise<void>;
  countByRole(role: UserRole): Promise<number>;
}

/**
 * Reads inside one atomic unit of work. Everything `updateUserRole` does —
 * the role write, the session revocation, and the audit-log entry — has to
 * commit or roll back together (#276): a crash between the role write and
 * the audit-log insert would leave a privilege change with no administrative
 * record of it, which is exactly the accountability trail this module exists
 * to keep.
 */
export interface AdminTransactionScope {
  userRoleRepository: UserRoleRepository;
  auditLogRepository: AuditLogRepository;
  sessionRevoker: SessionRevoker;
}

/** Runs `work` inside a single database transaction, handing it
 * transaction-scoped adapters so every write it performs is part of that
 * one unit of work. */
export interface AdminUnitOfWork {
  run<T>(work: (scope: AdminTransactionScope) => Promise<T>): Promise<T>;
}

export interface RecordAuditLogInput {
  actorId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/** `ARCHITECTURE.md` §4 planned a shared "audit-logging decorator" in
 * `src/shared/` — never built (verified: nothing under `src/shared/`
 * mentions audit logging, and nothing anywhere wrote to `audit_logs`
 * before this module). `admin` is the first and only consumer so far, so
 * this stays module-local rather than speculatively generalized into a
 * shared decorator with one caller. */
export interface ListAuditLogFilter {
  limit: number;
  /** Keyset cursor — only rows strictly older than this are returned, the
   * same `before`-cursor pattern `notifications` uses (#101), so paging
   * past `MAX_LIMIT` rows stays possible without an unstable `skip`. */
  before?: Date;
}

/** Total number of audit log rows, ignoring both `limit` and the `before`
 * cursor of {@link ListAuditLogFilter}. Deliberately unpaged so the admin UI
 * can render a record/page total next to a single cursor page (#292) —
 * counting only what `list` returned would make `totalCount` change on every
 * page, which is not what a total is for. */
export interface AuditLogRepository {
  record(input: RecordAuditLogInput): Promise<void>;
  list(filter: ListAuditLogFilter): Promise<AuditLogEntry[]>;
  count(): Promise<number>;
}

/**
 * Invalidates a user's existing sessions — called by `updateUserRole` after
 * a role change (security issue #12), same "genuinely shared identity
 * state" rationale as `UserRoleRepository` above. Deliberately narrower
 * than reaching for `auth`'s own `RefreshTokenRepository`/`TokenService`
 * ports or use cases: `admin` doesn't need (and shouldn't take on) the rest
 * of that module's surface for this one cross-cutting concern, so its
 * Prisma-backed implementation touches the shared `refresh_tokens` and
 * `users` tables directly instead.
 */
export interface SessionRevoker {
  /**
   * Revokes every outstanding refresh token for this user (so a stale
   * refresh token can't silently mint a new access token carrying the old
   * privileges) and bumps `users.token_version` (so any access token
   * already issued — which a refresh-token revocation alone can't touch —
   * stops passing the shared HTTP auth guard's version check on its very
   * next request, rather than remaining valid for the rest of its
   * ~15-minute lifetime).
   */
  revokeAllForUser(userId: string): Promise<void>;
}
