-- Issue #695: stable composite (createdAt DESC, id DESC) cursor index so
-- timestamp ties never cause rows to be skipped at a page boundary.
-- The old (userId, createdAt DESC) index is superseded by this one for
-- pagination queries; the (userId, status, createdAt DESC) index already
-- covers the status-filtered case. The old index is dropped to avoid
-- maintaining a redundant structure.
DROP INDEX IF EXISTS "notifications_user_id_created_at_idx";

CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_id_idx"
  ON "notifications" ("user_id", "created_at" DESC, "id" DESC);
