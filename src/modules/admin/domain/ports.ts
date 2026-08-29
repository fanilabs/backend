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
  listOpenDisputes(): Promise<DisputeReviewItem[]>;
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
export interface AuditLogRepository {
  record(input: RecordAuditLogInput): Promise<void>;
  list(limit: number): Promise<AuditLogEntry[]>;
}
