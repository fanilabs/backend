-- AlterTable
-- Additive, backward-compatible: existing rows default to 0, matching every
-- access token issued before this column existed (which carries no
-- tokenVersion claim at all and is treated as version 0 by the auth guard).
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
