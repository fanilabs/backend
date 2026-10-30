-- No historical ancestry is known: legacy tokens stay unassigned and are invalidated.
CREATE TABLE "session_families" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revoked_at" TIMESTAMP(3)
);
CREATE INDEX "session_families_user_id_idx" ON "session_families"("user_id");
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" TEXT REFERENCES "session_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
UPDATE "refresh_tokens" SET "revoked_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP WHERE "revoked_at" IS NULL;
