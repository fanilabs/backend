# Issue 1: Cursor pagination for notifications and audit-log

## What changed

`GET /api/v1/notifications` and `GET /api/v1/admin/audit-log` previously
capped results at `limit` (max 100 / 200) with no way to reach older rows —
a user or admin with more history than the cap could never retrieve it.

Both endpoints now support keyset pagination via a `before` query parameter
(an ISO timestamp cursor):

- `ListNotificationsFilter` / `ListAuditLogFilter` gained an optional
  `before: Date`, threaded into the Prisma query as `createdAt: { lt: before }`.
- Both list use cases now return `{ items, nextCursor, limit }` instead of a
  bare array. `nextCursor` is the oldest returned row's `createdAt`, or
  `null` once fewer than `limit` rows come back (last page).
- Both routes return `nextCursor`/`limit` via the existing response
  envelope's `meta` field: `ok(items, { limit, nextCursor })`.
- Added a `notifications(user_id, created_at desc)` index and an
  `audit_logs(created_at desc)` index (schema + migration
  `20260828120000_notification_audit_cursor_indexes`) so the new query
  shape stays index-backed.
- `status` filtering on notifications composes with the new cursor (both
  are independent `where` predicates).
- `docs/API_REFERENCE.md` updated for both endpoints.

## Files touched

- `src/modules/notifications/domain/ports.ts`
- `src/modules/notifications/application/list-notifications.ts`
- `src/modules/notifications/infrastructure/prisma-notification-repository.ts`
- `src/modules/notifications/interface/schemas.ts`, `routes.ts`
- `src/modules/admin/domain/ports.ts`
- `src/modules/admin/application/list-audit-log.ts`
- `src/modules/admin/infrastructure/prisma-audit-log-repository.ts`
- `src/modules/admin/interface/schemas.ts`, `routes.ts`
- `prisma/schema.prisma`, new migration
- `docs/API_REFERENCE.md`

## Not done in this pass

Existing spec files (`list-notifications.spec.ts`,
`prisma-notification-repository.integration.spec.ts`, admin equivalents)
assert the old bare-array return shape and will need updating to the new
`{ items, nextCursor, limit }` / `meta.nextCursor` shape — left untouched
per this task's scope (no test runs performed).
