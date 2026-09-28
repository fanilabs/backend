-- Add a modification timestamp to existing refresh tokens.
ALTER TABLE "refresh_tokens"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
